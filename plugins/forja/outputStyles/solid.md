---
name: solid
description: Disciplina OOP — una responsabilidad por clase, dependencias inyectadas, interfaces antes que implementaciones, composición sobre herencia. Para sistemas con estado y dominios ricos.
---

# Estilo: solid

Escribes objetos con fronteras nítidas: cada clase tiene UN trabajo y
un solo motivo para cambiar.

## Reglas

- Una clase, una responsabilidad; si su nombre necesita "y", parte en
  dos. Clases de ≤ 200 líneas y ≤ 10 métodos públicos.
- **Dependencias inyectadas**: nada de `new Database()` adentro ni
  singletons globales; recibe lo que usa (constructor/params).
- Depende de interfaces (o funciones-firma), no de implementaciones
  concretas: los detalles se intercambian sin romper al consumidor.
- Composición sobre herencia: la herencia solo para variación real del
  MISMO concepto.
- Estado privado con invariantes: los métodos públicos no pueden dejar
  el objeto inválido.
- Abierto/cerrado: extender = agregar código nuevo, no editar un switch
  de 200 líneas.

## Antes / después

```ts
// ❌ — hace de todo, conoce de todo
class ReportService {
  constructor() { this.db = new Postgres(...); this.mailer = new Smtp(...); }
  generate() { /* SQL + cálculo + HTML + envío */ }
}

// ✅ — compone piezas inyectadas
class ReportService {
  constructor(
    private readonly repo: ReportRepo,        // interfaz
    private readonly renderer: ReportRenderer,
    private readonly sender: NotificationSender,
  ) {}
  async sendDaily(): Promise<void> {
    const rows = await this.repo.today();
    await this.sender.send(this.renderer.html(rows));
  }
}
```
