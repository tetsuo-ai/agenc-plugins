import assert from "node:assert/strict";
import test from "node:test";
import { lintText } from "../plugins/pluma/server/lint.mjs";
test("Pluma rejects empty/oversized drafts and inherited style names", () => {
  for (const value of ["", " ", null, 12, "x".repeat(100001)]) assert.ok(lintText(value, "directo").error);
  for (const style of ["__proto__", "constructor", "toString"]) assert.match(lintText("A real draft", style).error, /unknown style/);
});
test("Pluma cannot pass a single blocking error even if its score is 88", () => {
  const result = lintText("I think the measured latency is 12 milliseconds.", "tecnico");
  assert.equal(result.score, 88);
  assert.equal(result.pass, false);
});
