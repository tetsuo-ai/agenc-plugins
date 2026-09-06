/**
 * JSON persistence for the portfolio and the thesis journal under the
 * plugin data directory. Writes are whole-file replacements (small data,
 * single-writer plugin server) with a temp-file swap so a crash never
 * leaves a torn store.
 */
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { normalizePredicate } from "./theses.mjs";

export const MAX_POSITIONS = 500;
export const MAX_THESES = 500;
const STORE_LIMIT = 8 * 1024 * 1024;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,11}$/u;

/** Fixed-name files, private atomic writes, bounded reads, and no symlink following. */
export function makeDataFiles(dataDir, subdirectory = "") {
  const configuredRoot = resolve(dataDir);
  mkdirSync(configuredRoot, { recursive: true, mode: 0o700 });
  if (!lstatSync(configuredRoot).isDirectory()) throw new Error("plugin data directory must be a real directory");
  const root = realpathSync(configuredRoot);
  if (subdirectory !== "" && !/^[a-z0-9_-]+$/iu.test(subdirectory)) throw new Error("invalid data subdirectory");
  const dir = subdirectory === "" ? root : join(root, subdirectory);

  function ensureDirectory() {
    if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) throw new Error("plugin data directory changed");
    if (subdirectory !== "") {
      try { mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== dir) throw new Error("unsafe data subdirectory");
  }
  function pathFor(name) {
    if (typeof name !== "string" || !/^[a-z0-9._-]{1,200}$/iu.test(name) || name === "." || name === "..") {
      throw new Error("invalid data filename");
    }
    ensureDirectory();
    return join(dir, name);
  }
  ensureDirectory();

  return {
    read(name, maxBytes = STORE_LIMIT) {
      const path = pathFor(name);
      let fd;
      try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error("unsafe or oversized data file");
        const chunks = [];
        let total = 0;
        while (true) {
          const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total));
          const size = readSync(fd, chunk, 0, chunk.length, null);
          if (size === 0) break;
          total += size;
          if (total > maxBytes) throw new Error("data file exceeds size limit");
          chunks.push(chunk.subarray(0, size));
        }
        return Buffer.concat(chunks).toString("utf8");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    },
    write(name, value, maxBytes = STORE_LIMIT) {
      const path = pathFor(name);
      if (typeof value !== "string" || Buffer.byteLength(value) > maxBytes) throw new Error("data file exceeds size limit");
      const temp = join(dir, `.${name}.${randomUUID()}.tmp`);
      let fd;
      try {
        fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeFileSync(fd, value);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        // Revalidate before replacing the directory entry; rename never follows a target symlink.
        ensureDirectory();
        renameSync(temp, path);
        return path;
      } finally {
        if (fd !== undefined) closeSync(fd);
        try { unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    },
  };
}

export function makeStores(dataDir) {
  const files = makeDataFiles(dataDir);
  function load(name, fallback, validate) {
    const contents = files.read(name);
    if (contents === null) return fallback;
    let value;
    try { value = JSON.parse(contents); } catch { throw new Error(`${name} is corrupt; restore or repair it before continuing`); }
    validate(value);
    return value;
  }

  return {
    loadHoldings() {
      return load("holdings.json", { importedAt: null, source: null, positions: [] }, validateHoldings);
    },
    saveHoldings(portfolio) {
      validateHoldings(portfolio);
      files.write("holdings.json", JSON.stringify(portfolio, null, 2));
    },
    loadTheses() {
      return load("theses.json", [], validateTheses);
    },
    saveTheses(theses) {
      validateTheses(theses);
      files.write("theses.json", JSON.stringify(theses, null, 2));
    },
  };
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const optionalNumber = (value) => value == null || Number.isFinite(value);
const optionalText = (value, max) => value == null || (typeof value === "string" && value.length <= max);

function validateHoldings(value) {
  if (!object(value) || !Array.isArray(value.positions) || value.positions.length > MAX_POSITIONS
      || !optionalText(value.source, 256) || !optionalText(value.importedAt, 64)
      || value.positions.some((p) => !object(p) || !SYMBOL.test(p.symbol) || !Number.isFinite(p.quantity) || p.quantity === 0
        || !optionalNumber(p.costBasis) || !optionalNumber(p.lastPrice) || !optionalNumber(p.expenseRatioPct)
        || !["stock", "fund", "cash"].includes(p.kind))) {
    throw new Error(`invalid holdings store (maximum ${MAX_POSITIONS} positions)`);
  }
}

function validateTheses(value) {
  if (!Array.isArray(value) || value.length > MAX_THESES || value.some((t) => !object(t)
      || typeof t.id !== "string" || !/^thesis_[a-z0-9_-]{1,100}$/iu.test(t.id) || !SYMBOL.test(t.symbol)
      || typeof t.thesis !== "string" || t.thesis.length < 10 || t.thesis.length > 10000
      || !optionalText(t.horizon, 256) || !optionalText(t.exitConditions, 10000)
      || !optionalText(t.openedAt, 64) || !optionalText(t.lastScan, 64)
      || !["open", "holds", "partial", "broken"].includes(t.status)
      || !Array.isArray(t.citedMetrics) || t.citedMetrics.length > 32
      || t.citedMetrics.some((p) => normalizePredicate(p).error !== undefined))
      || new Set(value.map((t) => t.id)).size !== value.length) {
    throw new Error(`invalid theses store (maximum ${MAX_THESES} theses)`);
  }
}
