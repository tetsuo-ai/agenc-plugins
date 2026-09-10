import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const corpus = JSON.parse(readFileSync(new URL("../plugins/olimpo/corpus/problems-original.json", import.meta.url)));
const byId = Object.fromEntries(corpus.map(p => [p.id, p]));
const checked = new Set();
function exercise(id, answer, run) {
  checked.add(id);
  test(id + ": derivation regression", () => {
    const p = byId[id];
    assert.ok(p);
    assert.equal(p.answer, answer);
    assert.equal(p.provenance.check, id);
    run();
  });
}
const near = (a,b) => assert.ok(Math.abs(a-b) <= 1e-8 * Math.max(1,Math.abs(a),Math.abs(b)), a+" != "+b);
const gcd = (a,b) => b ? gcd(b,a%b) : a;
const bits = n => n.toString(2).replaceAll("0","").length;

exercise("olimpo-nt-001", "1", () => {
  for(let n=1;n<=1000;n++) { assert.equal(gcd(13*n+5,8*n+3),1); assert.equal(8*(13*n+5)-13*(8*n+3),1); }
});
exercise("olimpo-nt-002", "4", () => assert.equal(3n**2026n%7n,4n));
exercise("olimpo-nt-003", "9", () => {
  const pairs=[];
  for(let x=1;x<=42;x++) for(let y=1;y<=42;y++) if(6*(x+y)===x*y) pairs.push([x,y]);
  assert.equal(pairs.length,9);
  for(const [x,y] of pairs) { assert.ok(x>6&&y>6); assert.equal((x-6)*(y-6),36); }
  assert.deepEqual(pairs.map(([x])=>x-6),[1,2,3,4,6,9,12,18,36]);
});
exercise("olimpo-nt-004", "0", () => {
  for(let x=1;x<=200;x++) for(let y=1;y<=200;y++) assert.notEqual(x*x+y*y,3*x*y);
  for(let y=1;y<=100;y++) {
    const a=y*(3+Math.sqrt(5))/2, b=3*y-a;
    assert.ok(0<b&&b<y&&y<a);
    near(a*b,y*y); near(a*a-3*y*a+y*y,0);
  }
});
exercise("olimpo-al-001", "48", () => {
  for(let i=-40;i<=80;i++) for(let j=-40;j<=80;j++) {
    const x=i/4,y=j/4,z=12-x-y, q=x*x+y*y+z*z;
    assert.ok(q>=48); near(q-48,(x-4)**2+(y-4)**2+(z-4)**2);
  }
  assert.equal(4**2*3,48);
});
exercise("olimpo-al-002", null, () => {
  let u=2n;
  for(let n=0n;n<=60n;n++) { assert.equal(u,5n*2n**n-3n); u=2n*u+3n; }
});
exercise("olimpo-al-003", "31", () => {
  const p=t=>t*t+t+1;
  assert.deepEqual([p(0),p(1),p(2),p(5)],[1,3,7,31]);
});
exercise("olimpo-al-004", null, () => {
  for(let p=1;p<=50;p++) for(let q=1;q<=50;q++) {
    const a=p/4,b=q/4,c=1/(a*b),s=a+b+c, Q=a*a+b*b+c*c;
    assert.ok(s>=3-1e-12); assert.ok(Q>=s-1e-12);
    near(3*Q-s*s,(a-b)**2+(b-c)**2+(c-a)**2);
  }
  assert.equal(1+1+1,1**2+1**2+1**2);
});
exercise("olimpo-ge-001", "3", () => { assert.equal(Math.hypot(9,12),15); assert.equal((9*12/2)/((9+12+15)/2),3); });
exercise("olimpo-ge-002", null, () => {
  for(let x=-4;x<=12;x++) for(let y=1;y<=12;y++) {
    const G=[(12+x)/3,y/3],M=[(12+x)/2,y/2],N=[x/2,y/2];
    near(G[0],(2/3)*M[0]); near(G[1],(2/3)*M[1]);
    near(G[0],12+(2/3)*(N[0]-12)); near(G[1],(2/3)*N[1]);
    near(Math.hypot(...G),2*Math.hypot(M[0]-G[0],M[1]-G[1]));
  }
});
exercise("olimpo-ge-003", "56.25", () => {
  for(let i=1;i<1500;i++) { const t=i/100; near(t*(15-t),56.25-(t-7.5)**2); assert.ok(t*(15-t)<=56.25); }
  assert.equal(7.5**2,56.25);
});
exercise("olimpo-ge-004", "2.8", () => {
  const altitude=8*6/10,BH=8*8/10,CH=6*6/10;
  const r1=(BH*altitude/2)/((BH+altitude+8)/2),r2=(CH*altitude/2)/((CH+altitude+6)/2);
  near(r1,1.6); near(r2,1.2); near(r1+r2,2.8);
});
exercise("olimpo-co-001", "20", () => {
  let count=0;
  for(let mask=0;mask<256;mask++) if(bits(mask)===3 && (mask&(mask<<1))===0) count++;
  assert.equal(count,20);
});
exercise("olimpo-co-002", "66", () => {
  const paths=(x,y)=>x===2&&y===2?0:x===5&&y===4?1:(x<5?paths(x+1,y):0)+(y<4?paths(x,y+1):0);
  assert.equal(paths(0,0),66);
});
exercise("olimpo-co-003", "6", () => {
  const hasPair=a=>a.some((x,i)=>a.some((y,j)=>i!==j&&y%x===0));
  for(let mask=0;mask<1024;mask++) if(bits(mask)===6) assert.ok(hasPair(Array.from({length:10},(_,i)=>i+1).filter((_,i)=>mask&(1<<i))));
  assert.equal(hasPair([6,7,8,9,10]),false);
});
exercise("olimpo-co-004", null, () => {
  const edges=new Map(); let index=0;
  for(let a=0;a<6;a++) for(let b=a+1;b<6;b++) edges.set(a+","+b,index++);
  const triangles=[];
  for(let a=0;a<6;a++) for(let b=a+1;b<6;b++) for(let c=b+1;c<6;c++) triangles.push([edges.get(a+","+b),edges.get(a+","+c),edges.get(b+","+c)]);
  for(let mask=0;mask<32768;mask++) assert.ok(triangles.some(([a,b,c])=>((mask>>a)&1)===((mask>>b)&1)&&((mask>>b)&1)===((mask>>c)&1)));
});
test("every original exercise has its own deterministic regression", () => assert.deepEqual([...checked].sort(),Object.keys(byId).sort()));
