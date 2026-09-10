import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAnswer, normalizeProblem, problemAtLevel, makeProgressStore, makeIngestStore } from "../plugins/olimpo/server/corpus.mjs";
import { withMcp } from "./support/mcp.mjs";
test("olimpo: do not leak short answers before solution level", () => {
  const p=normalizeProblem({id:"2050-1",statement:"A synthetic mathematical problem statement.",answer:"123"});
  for(const level of [undefined,"statement","hint1","hints","keyIdea"]) assert.equal(problemAtLevel(p,level).answer,undefined);
  assert.equal(problemAtLevel(p,"solution").answer,"123");
  assert.equal(p.solutionType,null);
});
test("olimpo: no decimal stripping or substring false positives", () => {
  assert.equal(checkAnswer({answer:"5"},"1.5").correct,false);
  for(const value of ["91234","not 123","1,23","12 3",""]) assert.equal(checkAnswer({answer:"123"},value).correct,false);
  assert.equal(checkAnswer({answer:"1.5"},"1.5").correct,true);
});
test("olimpo: private stores preserve corrupted files and reject built-in duplicates", () => {
  const dir=mkdtempSync(join(tmpdir(),"olimpo-regression-"));
  try {
    const p=makeProgressStore(dir), i=makeIngestStore(dir,["1959-1"]);
    assert.equal(i.ingest({id:"1959-1",statement:"A synthetic mathematical problem statement."}).rejected.length,1);
    p.mark("2050-1",{status:"solved"});
    assert.equal(statSync(join(dir,"progress.json")).mode&0o777,0o600);
    for(const file of ["progress.json","user-problems.json"]) writeFileSync(join(dir,file),"CORRUPTED");
    assert.throws(()=>p.mark("2050-1",{status:"learning"}),/preserving/);
    assert.throws(()=>i.ingest({id:"2050-1",statement:"A synthetic mathematical problem statement."}),/preserving/);
    assert.equal(readFileSync(join(dir,"progress.json"),"utf8"),"CORRUPTED");
    assert.equal(readFileSync(join(dir,"user-problems.json"),"utf8"),"CORRUPTED");
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("olimpo: notifications cannot mutate progress via native stdio", async () => {
  await withMcp("olimpo",async({tool,child})=>{
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"tools/call",params:{name:"progress_mark",arguments:{id:"1959-1",status:"solved"}}})+"\n");
    assert.deepEqual((await tool("progress_list")).entries,[]);
  });
});
