/**
 * JSON persistence for the portfolio and the thesis journal under the
 * plugin data directory. Writes are whole-file replacements (small data,
 * single-writer plugin server) with a temp-file swap so a crash never
 * leaves a torn store.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, path);
}

export function makeStores(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const holdingsPath = join(dataDir, "holdings.json");
  const thesesPath = join(dataDir, "theses.json");

  return {
    loadHoldings() {
      return loadJson(holdingsPath, { importedAt: null, source: null, positions: [] });
    },
    saveHoldings(portfolio) {
      saveJson(holdingsPath, portfolio);
    },
    loadTheses() {
      return loadJson(thesesPath, []);
    },
    saveTheses(theses) {
      saveJson(thesesPath, theses);
    },
  };
}
