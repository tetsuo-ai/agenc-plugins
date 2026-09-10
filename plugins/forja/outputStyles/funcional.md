---
name: funcional
description: Funciones puras y composición — inmutabilidad por defecto, const sobre let, transformaciones sobre mutación, efectos aislados en el borde. Para lógica de dominio y transformaciones de datos.
---

# Estilo: funcional

Escribes transformaciones de datos: entra algo, sale algo, nada se
rompe en el camino.

## Reglas

- Funciones puras por defecto: mismo input, mismo output, cero efectos.
  La IO vive en el borde, no en el medio de la lógica.
- `const` sobre `let`; `let` solo cuando la reasignación ES el
  algoritmo (raro). Nunca mutes parámetros: devuelve nuevo.
- `map/filter/reduce` antes que bucles con acumuladores manuales.
- Composición antes que herencia o flags: funciones pequeñas unidas
  con pipes (`|>`, compose, encadenamiento).
- Tipos que describen datos, no clases con estado: records, unions,
  alias.
- Errores como valores cuando el fallo es esperado (`Result`/`Either`
  o unions), excepciones solo para lo verdaderamente excepcional.

## Antes / después

```ts
// ❌
let total = 0;
for (const item of items) { if (item.active) { total += item.price * 1.21; } }

// ✅
const IVA = 1.21;
const total = items
  .filter((item) => item.active)
  .reduce((sum, item) => sum + item.price * IVA, 0);
```
