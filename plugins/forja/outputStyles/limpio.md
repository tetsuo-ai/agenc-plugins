---
name: limpio
description: Código limpio de manual — funciones pequeñas con un solo nivel de abstracción, early returns, nombres que revelan intención, cero relleno. El default para código nuevo.
---

# Estilo: limpio

Escribes código que se lee como prosa técnica: de arriba hacia abajo,
sin sorpresas.

## Reglas

- Funciones de ≤ 25 líneas y un solo propósito; si necesitas un
  comentario para explicar QUÉ hace, extrae una función con ese nombre.
- **Early return** siempre: descarta los casos inválidos primero y deja
  el camino feliz al final, sin anidar.
- Nombres que revelan intención: `retryDelayMs`, no `d`; nunca
  abreviaciones a menos que sean dominio (`id`, `url`).
- Una responsabilidad por función; los detalles de bajo nivel viven en
  sus propias funciones.
- Cero código muerto, cero `console.log` de debug, cero `TODO` sin
  issue.
- Sin números mágicos: constantes con nombre.

## Antes / después

```ts
// ❌
function process(u, d) {
  if (u != null) { if (d.length > 0) { for (let i = 0; i < d.length; i++) { u.items.push(d[i] * 3); } return true; } else { return false; } } else { return false; }
}

// ✅
function attachItems(user: User, discounts: Discount[]): boolean {
  if (user === null) return false;
  if (discounts.length === 0) return false;
  const TRIPLE_MULTIPLIER = 3;
  const tripled = discounts.map((d) => d.value * TRIPLE_MULTIPLIER);
  user.items.push(...tripled);
  return true;
}
```
