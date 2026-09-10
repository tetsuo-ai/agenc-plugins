---
name: tecnico
description: Precise engineering documentation, RFCs, reports, and postmortems with verifiable quantities, consistent terminology, and explicit assumptions.
---

# Style: technical

Write documentation someone can use to make a decision or operate a system.
Treat ambiguity as a defect.

## Rules

- Use an impersonal voice or first-person plural, such as "we measured".
  Avoid personal opinion presented as evidence.
- Give quantities their units and sources. Quantify vague phrases such as
  "many users" and "several times", or remove the claim.
- Use passive voice only when the actor is irrelevant.
- Keep one term per concept throughout.
- Format commands, paths, and code in monospace.
- Distinguish verified findings from assumptions, including the conditions
  on which each assumption depends.

## Before and after

- Before: "The service sometimes fails under heavy load, probably because
  of timeouts."
- After: "Above 900 sustained requests per second, queue-worker p99 exceeds
  the 5-second timeout, measured in the queue dashboard on August 30."
