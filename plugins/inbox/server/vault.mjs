/**
 * Local attachment vault: downloaded attachments filed by content hash
 * under the plugin data directory with a JSON index (filename, sender,
 * date, Gmail ids) so "the PDF Alex sent in March" is one lookup.
 * Downloading is explicit - nothing is fetched behind the user's back.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { imageMime } from "./image-validation.mjs";

const IMAGE_LIMIT = 5 * 1024 * 1024;
const FILE_LIMIT = 32 * 1024 * 1024;
const ATTACHMENT_LIMIT = 8;
const WORK_LIMIT = 64 * 1024 * 1024;
const FILE_MIMES = new Set(["text/plain", "text/csv", "text/calendar", "application/pdf", "application/zip"]);

/** Build user-only MCP resources while retaining the ordinary structured result. */
export function vaultDisplayResult(value, files) {
  const content = [];
  const attached = [];
  const notAttached = [];
  let imageBytes = 0;
  let workBytes = 0;
  for (const file of files) {
    const name = String(file.filename ?? basename(file.storedAs ?? file.path ?? "attachment"))
      .replace(/[\x00-\x1f\x7f]/gu, " ").trim().slice(0, 120) || "attachment";
    const path = file.storedAs ?? file.path;
    let size = file.sizeBytes;
    let reason;
    if (attached.length >= ATTACHMENT_LIMIT) reason = "8 attachment limit";
    if (!reason) {
      try {
        const stat = lstatSync(path);
        if (!stat.isFile()) reason = "not a regular file";
        else size = stat.size;
      } catch { reason = "file unavailable"; }
    }
    if (!reason && size > FILE_LIMIT) reason = "file exceeds 32 MiB";
    let bytes;
    if (!reason) {
      try { bytes = readFileSync(path); } catch { reason = "file unavailable"; }
    }
    if (!reason && bytes.length > FILE_LIMIT) reason = "file exceeds 32 MiB";
    const detectedImage = !reason ? imageMime(bytes) : null;
    const mimeType = detectedImage ?? (FILE_MIMES.has(file.mimeType) ? file.mimeType : "application/octet-stream");
    if (!reason && detectedImage && bytes.length > IMAGE_LIMIT) reason = "image exceeds 5 MiB";
    if (!reason && detectedImage && imageBytes + bytes.length > IMAGE_LIMIT) reason = "images exceed 5 MiB per result";
    const base64Length = !reason ? Math.ceil(bytes.length / 3) * 4 : 0;
    if (!reason && workBytes + 1 + base64Length > WORK_LIMIT) reason = "64 MiB result budget";
    if (reason) {
      notAttached.push({ filename: name, sizeBytes: size, reason });
      continue;
    }
    workBytes += 1 + base64Length;
    if (detectedImage) imageBytes += bytes.length;
    attached.push({ filename: name, sizeBytes: bytes.length, mimeType });
    content.push({
      type: "resource",
      annotations: { audience: ["user"] },
      resource: {
        uri: `agenc:inbox:vault:${createHash("sha256").update(bytes).digest("hex")}`,
        name,
        mimeType,
        blob: bytes.toString("base64"),
      },
    });
  }
  const summary = [
    `Attached ${attached.length} file${attached.length === 1 ? "" : "s"} for the user.`,
    ...attached.map((file) => `${file.filename} (${file.sizeBytes} bytes, ${file.mimeType}): attached.`),
    ...notAttached.map((file) => `${file.filename} (${file.sizeBytes ?? "unknown"} bytes): not attached, ${file.reason}.`),
  ];
  return {
    structuredContent: notAttached.length ? { ...value, notAttached } : value,
    content: [{ type: "text", text: summary.join("\n") }, ...content],
  };
}

export function makeVault(dataDir) {
  const vaultDir = join(dataDir, "vault");
  const indexPath = join(vaultDir, "index.json");
  mkdirSync(vaultDir, { recursive: true, mode: 0o700 });

  function loadIndex() {
    try {
      const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
      if (!Array.isArray(parsed.items)) throw new Error("Invalid vault index");
      return parsed.items;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new Error("Cannot read vault index; original preserved");
    }
  }

  function saveIndex(items) {
    const temporary = indexPath + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temporary, JSON.stringify({ items }, null, 2), { mode: 0o600, flag: "wx" });
      renameSync(temporary, indexPath);
    } finally { rmSync(temporary, { force: true }); }
  }

  return {
    store({ buffer, filename, mimeType, from, date, messageId }) {
      if (!Buffer.isBuffer(buffer) || buffer.length > 25 * 1024 * 1024) throw new Error("Attachment exceeds the 25 MiB vault limit");
      const items = loadIndex();
      const hash = createHash("sha256").update(buffer).digest("hex");
      const safeName = String(filename ?? "attachment").replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 80);
      const storedAs = join(vaultDir, `${hash.slice(0, 16)}-${safeName}`);
      const existing = items.find((item) => item.hash === hash);
      if (existing) return { path: existing.storedAs, hash, sizeBytes: buffer.length, duplicate: true };
      writeFileSync(storedAs, buffer, { mode: 0o600, flag: "wx" });
      if (existing === undefined) {
        items.push({
          hash,
          storedAs,
          filename: safeName,
          mimeType: mimeType ?? "application/octet-stream",
          sizeBytes: buffer.length,
          from: from ?? null,
          date: date ?? null,
          messageId: messageId ?? null,
          savedAt: new Date().toISOString(),
        });
        saveIndex(items);
      }
      return { path: storedAs, hash, sizeBytes: buffer.length, duplicate: existing !== undefined };
    },

    search({ query, from, after } = {}) {
      const items = loadIndex();
      const terms = String(query ?? "")
        .toLowerCase()
        .split(/\s+/u)
        .filter((term) => term.length > 0);
      return items.filter((item) => {
        if (from !== undefined && from !== null && !(item.from ?? "").toLowerCase().includes(String(from).toLowerCase())) return false;
        if (after !== undefined && after !== null && (item.date ?? "") < String(after)) return false;
        const haystack = `${item.filename} ${item.from ?? ""}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    },

    stats() {
      const items = loadIndex();
      return {
        files: items.length,
        totalBytes: items.reduce((a, item) => a + (item.sizeBytes ?? 0), 0),
        byType: tally(items.map((item) => (item.mimeType ?? "other").split("/")[0])),
      };
    },
  };
}

function tally(values) {
  const out = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}
