---
name: solid
description: One responsibility per class, injected dependencies, interfaces before implementations, and composition over inheritance for stateful domains.
---

# Style: solid

Give each class one job and one reason to change.

## Rules

- Split unrelated responsibilities. Target at most 200 lines and ten public
  methods per class.
- Inject dependencies through constructors or parameters instead of creating
  databases or using global singletons inside domain objects.
- Depend on interfaces or function signatures, not concrete implementations.
- Prefer composition. Use inheritance only for a genuine variation of the
  same concept.
- Keep state private and maintain invariants after every public operation.
- Extend behavior through new components rather than expanding giant switches.

## Before and after

```ts
// Before: construction, storage, rendering, and delivery are coupled.
class ReportService {
  constructor() {
    this.database = new Postgres();
    this.mailer = new Smtp();
  }
  generate() { /* SQL, calculation, HTML, and delivery */ }
}

// After: responsibilities are composed through injected interfaces.
class ReportService {
  constructor(
    private readonly repository: ReportRepository,
    private readonly renderer: ReportRenderer,
    private readonly sender: NotificationSender,
  ) {}
  async sendDaily(): Promise<void> {
    const rows = await this.repository.today();
    await this.sender.send(this.renderer.html(rows));
  }
}
```
