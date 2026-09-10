# Mathematical review

Development review on 2026-09-10 by the coding assistant, without an independent
human reviewer or formal proof checker. Each solution was checked step by step
for assumptions, reversibility, boundary conditions and equality cases.
Finite checks in `tests/olimpo-mathematics.test.mjs` supplement those derivations;
they do not prove universal or real-valued claims.

| Exercise | Derivation | Reproducible check |
| --- | --- | --- |
| olimpo-nt-001 | Bézout combination equals 1 | GCD for n=1..1000 |
| olimpo-nt-002 | Six-term modular cycle | Exact BigInt exponentiation |
| olimpo-nt-003 | Divisor bijection | All positive x,y≤42 |
| olimpo-nt-004 | Smaller positive Vieta root | x,y≤200 plus root identities |
| olimpo-al-001 | Squares around the mean | Rational grid and equality |
| olimpo-al-002 | Shift and induction | BigInt recurrence for n=0..60 |
| olimpo-al-003 | Unique coefficient system | Exact evaluations |
| olimpo-al-004 | AM–GM and squared differences | Positive rational grid |
| olimpo-ge-001 | Area = inradius × semiperimeter | Pythagorean/area calculation |
| olimpo-ge-002 | Vector barycenter | Noncollinear integer-coordinate triangles |
| olimpo-ge-003 | Complete the square | Rational-grid maximum |
| olimpo-ge-004 | Similarity scales inradii | Independent altitude/area calculation |
| olimpo-co-001 | Bijection with three of six positions | All 256 light patterns |
| olimpo-co-002 | Subtract paths through the point | All monotone 5×4 paths |
| olimpo-co-003 | Five odd-part classes | All 6-subsets and a 5-set counterexample |
| olimpo-co-004 | Three same-color neighbors | All 32768 colorings of K6 |

Text-answer matches are not proof grading. User-imported exercises do not
inherit this review.
