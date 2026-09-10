import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGACY_TAG_ALIASES, loadCorpus, normalizeProblem, problemAtLevel, searchProblems, studyPlan, checkAnswer, makeIngestStore, makeProgressStore } from "../plugins/olimpo/server/corpus.mjs";
import { withMcp } from "./support/mcp.mjs";
const corpus=loadCorpus(new URL("../plugins/olimpo/corpus/",import.meta.url).pathname);
test("Olympus: English tags preserve legacy search inputs", () => {
  for (const [legacy, english] of Object.entries(LEGACY_TAG_ALIASES)) {
    const current = searchProblems(corpus, { query: english });
    assert.ok(current.length > 0, english);
    assert.deepEqual(searchProblems(corpus, { query: legacy }), current, legacy);
    assert.ok(corpus.every(problem => !problem.tags.includes(legacy)), legacy);
  }
  const imported = normalizeProblem({ id: "user-legacy-tag", statement: "A sufficiently long private exercise.", tags: ["factorizacion"] });
  assert.equal(searchProblems([imported], { query: "factorizacion" }).length, 1);
});
test("Olympus: all sixteen exercises expose English authored text", () => {
  for (const problem of corpus) {
    assert.equal(problem.provenance.kind, "original");
    assert.equal(problem.provenance.check, problem.id);
    for (const text of [problem.title, problem.statement, problem.keyIdea, ...problem.hints, problem.solution, problem.sourceNote]) {
      assert.equal(typeof text, "string", problem.id);
      assert.doesNotMatch(text, /[¿¡]|\b(?:Sea|Sean|Supongamos|Demuestra|Calcula|Ejercicio|explicación|revisión)\b/u, problem.id);
      assert.ok(!text.includes(String.fromCodePoint(0x2014)), problem.id);
    }
  }
  assert.equal(normalizeProblem({ id: "user-untitled", statement: "A sufficiently long private exercise." }).title, "Exercise user-untitled");
});
test("olimpo: original IDs and unreviewed user provenance",()=>{
  assert.equal(corpus.length,16);
  const original=corpus.find(p=>p.id==="olimpo-nt-004");
  assert.equal(original.year,undefined); assert.equal(original.provenance.kind,"original");
  const imported=normalizeProblem({id:"user-test",statement:"A sufficiently long private exercise.",solution:"A proposed solution.",provenance:original.provenance});
  assert.equal(imported.provenance.kind,"user"); assert.equal(imported.provenance.review,"unreviewed"); assert.equal(imported.solutionType,"sketch");
  assert.equal(normalizeProblem({id:"user-test",statement:["not","text"]}),null);
  assert.equal(normalizeProblem({id:"user-test",statement:"a".repeat(20001)}),null);
  assert.equal(normalizeProblem({id:"2050-1",statement:"A legacy-format private exercise."}).year,2050);
});
test("olimpo: answers and solutions do not leak through earlier levels",()=>{
  for(const p of corpus) for(const level of [undefined,"statement","hint1","hints","keyIdea"]) {
    const shown=problemAtLevel(p,level); assert.equal(shown.answer,undefined); assert.equal(shown.solution,undefined);
    assert.ok(!JSON.stringify(shown).includes(p.solution));
  }
  for(const p of corpus) assert.equal(problemAtLevel(p,"solution").solution,p.solution);
});
test("olimpo: conservative checking and deterministic search/plans",()=>{
  const numeric=corpus.find(p=>p.id==="olimpo-ge-003");
  assert.equal(checkAnswer(numeric,"56.25").correct,true);
  assert.equal(checkAnswer(numeric,"56,25").correct,false);
  assert.equal(checkAnswer(numeric,"225/4").correct,false);
  assert.equal(checkAnswer(numeric,"56.25").comparison,"normalized-text-only");
  assert.equal(checkAnswer(corpus.find(p=>p.answer===null),"anything").applicable,false);
  assert.ok(searchProblems(corpus,{query:"vieta"}).some(p=>p.id==="olimpo-nt-004"));
  assert.deepEqual(studyPlan(corpus,{count:10}),studyPlan([...corpus].reverse(),{count:10}));
});
test("olimpo: unsafe stores fail closed and original exercises cannot be overwritten",()=>{
  const dir=mkdtempSync(join(tmpdir(),"olimpo-safe-"));
  try {
    const store=makeIngestStore(dir,corpus.map(p=>p.id));
    assert.equal(store.ingest({id:"olimpo-nt-001",statement:"An attempted replacement exercise."}).rejected[0].reason,"duplicate");
    const target=join(dir,"preserve.json");writeFileSync(target,'{"entries":[]}');
    symlinkSync(target,join(dir,"progress.json"));
    const progress=makeProgressStore(dir);
    assert.throws(()=>progress.mark("olimpo-nt-001",{status:"solved"}),/preserving/);
    assert.equal(readFileSync(target,"utf8"),'{"entries":[]}');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("olimpo: all nine MCP tools work through real stdio",async()=>{
  await withMcp("olimpo",async({call,tool,child})=>{
    const init=await call("initialize",{protocolVersion:"2025-06-18"});
    assert.equal(init.result.serverInfo.version,"0.2.4");
    assert.equal((await call("tools/list")).result.tools.length,9);
    assert.equal((await tool("problems_list",{limit:100})).count,16);
    assert.ok((await tool("problem_search",{query:"vieta"})).problems.some(p=>p.id==="olimpo-nt-004"));
    const shown=await tool("problem_get",{id:"olimpo-nt-001"});
    assert.equal(shown.year,undefined);assert.equal(shown.answer,undefined);
    assert.equal((await tool("problem_get",{id:shown.id,level:"solution"})).answer,"1");
    assert.ok((await tool("problem_random",{topic:"geometry"})).id.startsWith("olimpo-ge-"));
    assert.equal((await tool("answer_check",{id:"olimpo-co-001",attempt:"20"})).correct,true);
    assert.equal((await tool("study_plan",{count:3})).plan.length,3);
    await tool("progress_mark",{id:shown.id,status:"attempted"});
    assert.equal((await tool("progress_list")).entries.length,1);
    const imported=await tool("ingest",{items:[{id:"user-example",statement:"A sufficiently long private exercise.",solution:"Unverified user solution.",provenance:{kind:"original"}}]});
    assert.deepEqual(imported.added,["user-example"]);
    assert.equal((await tool("problem_get",{id:"user-example"})).provenance.review,"unreviewed");
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"tools/call",params:{name:"progress_mark",arguments:{id:shown.id,status:"solved"}}})+"\n");
    assert.equal((await tool("progress_list")).entries[0].status,"attempted");
  });
});
test("olimpo: invalid tool inputs cannot mutate state",async()=>{
  await withMcp("olimpo",async({call,tool})=>{
    for(const [name,args] of [
      ["ingest",{items:"wrong"}],["ingest",{items:[]}],["study_plan",{count:-1}],
      ["study_plan",{count:3.5}],["problems_list",{topic:"invented"}],
      ["problem_get",{id:"olimpo-nt-001",level:"hidden"}],["progress_mark",{id:"olimpo-nt-001",status:"invalid"}],
      ["progress_mark",{id:123,status:"solved"}],["progress_list",null],["progress_list",{extra:true}]
    ]) assert.equal((await call("tools/call",{name,arguments:args})).error.code,-32602,name);
    assert.deepEqual((await tool("progress_list")).entries,[]);
  });
});
