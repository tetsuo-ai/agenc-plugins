import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const root=new URL("../plugins/olimpo/",import.meta.url);
test("olimpo release: no copied or misattributed draft corpus ships",()=>{
  const files=readdirSync(new URL("corpus/",root)).sort();
  assert.deepEqual(files,["REVIEW.md","SOURCES.md","problems-original.json"]);
  const entries=JSON.parse(readFileSync(new URL("corpus/problems-original.json",root),"utf8"));
  assert.equal(entries.length,16);
  assert.equal(new Set(entries.map(p=>p.id)).size,16);
  for(const topic of ["algebra","geometry","number-theory","combinatorics"]) assert.equal(entries.filter(p=>p.topic===topic).length,4);
  for(const p of entries) {
    assert.match(p.id,/^olimpo-(al|ge|nt|co)-00[1-4]$/u);
    assert.equal(p.year,undefined); assert.equal(p.number,undefined);
    assert.ok(p.statement.length>60 && p.solution.length>150);
    assert.equal(p.solutionType,"full");
    assert.ok(p.hints.length>=2 && p.hints.length<=5);
    assert.deepEqual(p.provenance,{kind:"original",author:"tetsuo-ai",license:"MIT",review:"derivation-and-deterministic-checks",check:p.id});
    assert.ok(p.answer===null||typeof p.answer==="string");
    assert.ok(p.sourceNote.includes("not an official IMO problem"));
  }
});
test("olimpo release: license and review provenance accompany the actual corpus",()=>{
  assert.equal(readFileSync(new URL("LICENSE",root),"utf8"),readFileSync(new URL("../LICENSE",new URL("../",root)),"utf8"));
  const sources=readFileSync(new URL("corpus/SOURCES.md",root),"utf8");
  const review=readFileSync(new URL("corpus/REVIEW.md",root),"utf8");
  assert.match(sources,/AI assistance/u); assert.match(sources,/MIT/u);
  assert.match(review,/without an independent/u);
  const entries=JSON.parse(readFileSync(new URL("corpus/problems-original.json",root),"utf8"));
  for(const p of entries) assert.ok(review.includes(p.id),p.id);
});
