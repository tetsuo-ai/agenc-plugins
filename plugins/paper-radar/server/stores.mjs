/**
 * JSON persistence for the paper-radar ledger under the plugin data
 * directory, with temp-file swap writes. Pure data in/out - no schema
 * logic here.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export function makeStores(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const ledgerPath = join(dataDir, "ledger.json");

  return {
    withWriteLock(action) {
      const lock = join(dataDir, "ledger.lock");
      try { mkdirSync(lock, { mode: 0o700 }); }
      catch (error) {
        if (error.code === "EEXIST") throw new Error("Ledger is busy; retry after the other writer finishes. A lock left by a crash requires operator recovery.");
        throw error;
      }
      try { return action(); }
      finally { rmdirSync(lock); }
    },
    loadLedger() {
      try {
        const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
        if (!Array.isArray(parsed.entries)) throw new Error("Invalid ledger: entries must be an array");
        return parsed.entries;
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw new Error("Cannot read the ledger; preserving the original file", { cause: error });
      }
    },
    saveLedger(entries) {
      const temporary = `${ledgerPath}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify({ entries }, null, 2), { mode: 0o600, flag: "wx" });
        renameSync(temporary, ledgerPath);
      } finally {
        rmSync(temporary, { force: true });
      }
    },
  };
}
