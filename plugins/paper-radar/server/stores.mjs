/**
 * JSON persistence for the paper-radar ledger under the plugin data
 * directory, with temp-file swap writes. Pure data in/out — no schema
 * logic here.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function makeStores(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const ledgerPath = join(dataDir, "ledger.json");

  return {
    loadLedger() {
      try {
        const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
        return Array.isArray(parsed.entries) ? parsed.entries : [];
      } catch {
        return [];
      }
    },
    saveLedger(entries) {
      writeFileSync(`${ledgerPath}.tmp`, JSON.stringify({ entries }, null, 2));
      renameSync(`${ledgerPath}.tmp`, ledgerPath);
    },
  };
}
