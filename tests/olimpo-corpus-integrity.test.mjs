// Release gates: these deliberately expose known unresolved corpus defects.
// Do not weaken/remove them to merge the PR; restore and verify the sources.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const root=new URL("../plugins/olimpo/corpus/",import.meta.url);
test("olimpo release: known truncated statements contain the actual questions",()=>{
  const entries=JSON.parse(readFileSync(new URL("problems-sourced.json",root),"utf8"));
  for(const id of ["1959-2","1959-3"]){
    const p=entries.find(p=>p.id===id);
    assert.ok(p && p.statement.length>120 && !/(?: is|:)$/u.test(p.statement.trim()),id+": incomplete question; verify against an authoritative source");
  }
});
test("olimpo release: redistribution provenance is recorded for the corpus",()=>{
  assert.ok(existsSync(new URL("SOURCES.md",root)),"Missing corpus/SOURCES.md with exact upstream URLs/revisions, applicable licenses/permissions and mathematical-review provenance. A mirror's repository license alone is insufficient evidence.");
});
