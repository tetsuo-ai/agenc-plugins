import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeVault, vaultDisplayResult } from "../plugins/inbox/server/vault.mjs";
import { withMcp } from "./support/mcp.mjs";

function fixture(directory, filename, bytes, mimeType) {
  const storedAs = join(directory, filename);
  writeFileSync(storedAs, bytes);
  return { storedAs, filename, mimeType, sizeBytes: bytes.length };
}

function gif() {
  return Buffer.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0, 59]);
}

function jpeg() {
  return Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 2, 0, 255, 217]);
}

function webp() {
  return Buffer.from([82, 73, 70, 70, 18, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 5, 0, 0, 0, 47, 0, 0, 0, 0, 0]);
}

test("vault display resources use Core MIME kinds, canonical blobs, and user audience", () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-display-mime-"));
  try {
    const kinds = [
      ["image.png", readFileSync(join("plugins", "inbox", "assets", "logo.png")), "application/octet-stream", "image/png"],
      ["image.jpg", jpeg(), "image/png", "image/jpeg"],
      ["image.webp", webp(), "image/webp", "image/webp"],
      ["image.gif", gif(), "image/gif", "image/gif"],
      ["note.txt", Buffer.from("hello"), "text/plain", "text/plain"],
      ["data.csv", Buffer.from("a,b\n1,2"), "text/csv", "text/csv"],
      ["event.ics", Buffer.from("BEGIN:VCALENDAR"), "text/calendar", "text/calendar"],
      ["report.pdf", Buffer.from("%PDF-1.4"), "application/pdf", "application/pdf"],
      ["bundle.zip", Buffer.from("PK\x03\x04"), "application/zip", "application/zip"],
      ["page.html", Buffer.from("<html></html>"), "text/html", "application/octet-stream"],
      ["fake.png", Buffer.from("not a PNG"), "image/png", "application/octet-stream"],
    ];
    for (const [name, bytes, declared, expected] of kinds) {
      const file = fixture(dir, name, bytes, declared);
      const result = vaultDisplayResult({ path: file.storedAs, filename: name }, [file]);
      assert.equal(result.content.length, 2);
      const [caption, block] = result.content;
      assert.equal(block.type, "resource");
      assert.deepEqual(block.annotations, { audience: ["user"] });
      assert.equal(block.resource.name, name);
      assert.equal(block.resource.mimeType, expected);
      assert.deepEqual(Buffer.from(block.resource.blob, "base64"), bytes);
      assert.equal(Buffer.from(block.resource.blob, "base64").toString("base64"), block.resource.blob);
      assert.equal(result.structuredContent.path, file.storedAs);
      assert.match(caption.text, new RegExp(name.replace(".", "\\."), "u"));
      assert.ok(!caption.text.includes(file.storedAs));
      assert.ok(!caption.text.includes(block.resource.blob));
      assert.ok(caption.text.length < 250);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vault display attaches eight and names every file left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-display-count-"));
  try {
    const files = Array.from({ length: 10 }, (_, index) => fixture(dir, `file-${index}.txt`, Buffer.from(`value-${index}`), "text/plain"));
    const result = vaultDisplayResult({ results: files }, files);
    assert.equal(result.content.length, 9);
    assert.equal(result.structuredContent.results.length, 10);
    assert.deepEqual(result.structuredContent.notAttached.map((entry) => entry.filename), ["file-8.txt", "file-9.txt"]);
    assert.ok(result.structuredContent.notAttached.every((entry) => entry.reason === "8 attachment limit"));
    assert.match(result.content[0].text, /file-8\.txt.*8 attachment limit/u);
    assert.match(result.content[0].text, /file-9\.txt.*8 attachment limit/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vault display reports oversized files and the encoded result budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-display-size-"));
  try {
    const oversized = fixture(dir, "oversized.bin", Buffer.from("x"), "application/octet-stream");
    truncateSync(oversized.storedAs, 32 * 1024 * 1024 + 1);
    const over = vaultDisplayResult({ results: [oversized] }, [oversized]);
    assert.equal(over.content.length, 1);
    assert.equal(over.structuredContent.notAttached[0].reason, "file exceeds 32 MiB");
    assert.match(over.content[0].text, /oversized\.bin.*file exceeds 32 MiB/u);
    const largeGif = fixture(dir, "large.gif", Buffer.concat([gif(), Buffer.alloc(5 * 1024 * 1024)]), "image/gif");
    const image = vaultDisplayResult({ results: [largeGif] }, [largeGif]);
    assert.equal(image.content.length, 1);
    assert.equal(image.structuredContent.notAttached[0].reason, "image exceeds 5 MiB");
    const imageA = fixture(dir, "image-a.gif", Buffer.concat([gif(), Buffer.alloc(3 * 1024 * 1024)]), "image/gif");
    const imageB = fixture(dir, "image-b.gif", Buffer.concat([gif(), Buffer.alloc(3 * 1024 * 1024)]), "image/gif");
    const images = vaultDisplayResult({ results: [imageA, imageB] }, [imageA, imageB]);
    assert.equal(images.content.length, 2);
    assert.equal(images.structuredContent.notAttached[0].reason, "images exceed 5 MiB per result");
    const first = fixture(dir, "first.bin", Buffer.alloc(25 * 1024 * 1024), "application/octet-stream");
    const second = fixture(dir, "second.bin", Buffer.alloc(25 * 1024 * 1024), "application/octet-stream");
    const aggregate = vaultDisplayResult({ results: [first, second] }, [first, second]);
    assert.equal(aggregate.content.length, 2);
    assert.equal(aggregate.structuredContent.notAttached[0].filename, "second.bin");
    assert.equal(aggregate.structuredContent.notAttached[0].reason, "64 MiB result budget");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vault search returns a display resource with short model text", async () => {
  const bytes = Buffer.from("example attachment");
  await withMcp("inbox", async ({ call, dataDir }) => {
    makeVault(dataDir).store({ buffer: bytes, filename: "example.txt", mimeType: "text/plain" });
    const reply = await call("tools/call", { name: "vault_search", arguments: { query: "example" } });
    const result = reply.result;
    assert.equal(result.content.length, 2);
    assert.equal(result.content[1].type, "resource");
    assert.deepEqual(result.content[1].annotations, { audience: ["user"] });
    assert.equal(result.content[1].resource.name, "example.txt");
    assert.deepEqual(Buffer.from(result.content[1].resource.blob, "base64"), bytes);
    assert.match(result.content[0].text, /example\.txt.*attached/u);
    assert.ok(!result.content[0].text.includes("/vault/"));
    assert.ok(result.content[0].text.length < 200);
    assert.ok(result.structuredContent.results[0].storedAs);
  });
});
