/** Bounded private JSON stores; no linked files and no silent corruption reset. */
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const MAX_BYTES = 4 * 1024 * 1024;
export function readJsonFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error("unsafe or oversized data file");
    const chunks = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(65536, MAX_BYTES + 1 - total));
      const size = readSync(fd, chunk, 0, chunk.length, null);
      if (size === 0) break;
      total += size;
      if (total > MAX_BYTES) throw new Error("data file exceeds size limit");
      chunks.push(chunk.subarray(0, size));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function makeDataStore(dataDir, name, initial, validate) {
  const configured = resolve(dataDir);
  mkdirSync(configured, { recursive: true, mode: 0o700 });
  if (!lstatSync(configured).isDirectory()) throw new Error("plugin data directory must not be a link");
  const root = realpathSync(configured);
  if (!/^[a-z-]+\.json$/u.test(name)) throw new Error("invalid store name");
  const path = join(root, name);
  const lock = path + ".lock";
  const ensureDirectory = () => {
    if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) throw new Error("plugin data directory changed");
  };
  const read = () => {
    ensureDirectory();
    try {
      const value = readJsonFile(path);
      validate(value);
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(initial);
      throw new Error("Cannot read store; preserving the original file", { cause: error });
    }
  };
  return {
    read,
    update(action) {
      ensureDirectory();
      try { mkdirSync(lock, { mode: 0o700 }); }
      catch (error) {
        if (error.code === "EEXIST") throw new Error("Store busy; retry. Crash locks require operator recovery.");
        throw error;
      }
      const temp = path + "." + randomUUID() + ".tmp";
      let fd;
      try {
        const value = read();
        const before = JSON.stringify(value);
        const result = action(value);
        validate(value);
        if (JSON.stringify(value) === before) return result;
        const contents = JSON.stringify(value, null, 2);
        if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error("store exceeds size limit");
        fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeFileSync(fd, contents);
        fsyncSync(fd);
        closeSync(fd); fd = undefined;
        ensureDirectory();
        renameSync(temp, path);
        return result;
      } finally {
        if (fd !== undefined) closeSync(fd);
        rmSync(temp, { force: true });
        rmdirSync(lock);
      }
    },
  };
}
