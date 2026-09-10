---
name: limpio
description: Small single-purpose functions, early returns, intention-revealing names, named constants, and no dead code. The default discipline for new code.
---

# Style: clean

Write code that reads clearly from top to bottom, without surprises.

## Rules

- Target functions of at most 25 lines with one purpose and one level of
  abstraction. Extract a well-named helper when an explanation is needed.
- Return early for invalid cases and keep the main path unnested.
- Choose names such as `retryDelayMs` instead of `d`. Use abbreviations only
  when established in the domain, such as `id` or `url`.
- Keep low-level details in their own functions.
- Remove dead code and debug calls. Link remaining TODOs to issues.
- Replace magic numbers with named constants.

## Before and after

```ts
// Before: nested flow and unexplained values.
function attachItems(user, discounts) {
  if (user != null) {
    if (discounts.length > 0) {
      user.items.push(...discounts.map((discount) => discount.value * 3));
      return true;
    }
  }
  return false;
}

// After: explicit guards and a named multiplier.
function attachItems(user: User | null, discounts: Discount[]): boolean {
  if (user === null) return false;
  if (discounts.length === 0) return false;
  const TRIPLE_MULTIPLIER = 3;
  const tripled = discounts.map((discount) => discount.value * TRIPLE_MULTIPLIER);
  user.items.push(...tripled);
  return true;
}
```
