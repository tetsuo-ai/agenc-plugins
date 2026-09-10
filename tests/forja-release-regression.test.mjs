import assert from "node:assert/strict";
import test from "node:test";
import { verifyCode } from "../plugins/forja/server/verify.mjs";
const rules = (result) => result.violations.map((item) => item.rule);
test("Forja rejects invalid input, inherited styles and missing comparison source", () => {
  for (const code of ["", " ", null, 12, "x".repeat(100001)]) assert.ok(verifyCode(code).error);
  for (const style of ["__proto__", "constructor", "toString"]) assert.match(verifyCode("let value = 1;", { style }).error, /unknown style/);
  assert.match(verifyCode("const value = 1;", { style: "minimal-diff" }).error, /requires original/);
  assert.match(verifyCode("const value = 1;", { language: "ruby" }).error, /language/);
});
test("Forja never passes blocking errors", () => {
  const result = verifyCode('console.log("debug");', { style: "defensivo" });
  assert.equal(result.score, 88); assert.equal(result.pass, false);
});
test("Forja does not suggest const for updated variables or remove used import aliases", () => {
  for (const update of ["total++", "++total", "total--", "--total", "total += 2", "total *= 2", "total ||= 2", "total ??= 2"]) {
    assert.ok(!rules(verifyCode(`let total = 1;\n${update};`, { style: "funcional" })).includes("let-could-be-const"), update);
  }
  const imported = verifyCode('import { create as build } from "./module.js";\nbuild();');
  assert.ok(!rules(imported).includes("dead-import"));
});
test("Forja ignores debug-looking strings/comments and braces inside JS literals", () => {
  const result = verifyCode('function example() {\n  const message = "} console.log(fake)";\n  // console.log(fake); {{{\n  return message;\n}', { style: "defensivo" });
  assert.ok(!rules(result).includes("debug-leftover"));
  assert.equal(result.stats.maxFnLines, 5);
});
