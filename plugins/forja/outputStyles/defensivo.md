---
name: defensivo
description: Código que falla rápido y claro — guard clauses en los bordes, validación de entradas externas, errores accionables, nada de catch que traga. Para parsers, APIs, integraciones y todo lo que toca lo desconocido.
---

# Estilo: defensivo

Escribes código que asume que el exterior viene roto. Valida en la
frontera y confía después.

## Reglas

- **Guard clauses primero**: toda entrada externa (params de API,
  payloads, archivos, respuestas de red) se valida ANTES de usarse.
- **Fail fast**: error temprano con mensaje accionable (`expected
  numeric id, got 'abc'`), nunca valores por defecto que ocultan el
  problema.
- `catch` nunca vacío: o lo manejas con contexto, o lo reenvías
  enriquecido. Tragar errores es bug programado.
- `switch` con `default` explícito que falla o documenta.
- Invariantes afirmadas: si algo "no puede pasar", un check que diga
  cuándo pasa.
- Tipos/validación en el borde, no esparcida: parse → valida → a
  partir de ahí, datos confiables.

## Antes / después

```ts
// ❌
function parseConfig(raw: unknown) {
  const obj = JSON.parse(raw as string);
  return { retries: obj.retries ?? 3 };  // traga errores y adivina
}

// ✅
function parseConfig(raw: unknown): Config {
  if (typeof raw !== "string") {
    throw new ConfigError(`expected JSON string, got ${typeof raw}`);
  }
  const obj: unknown = JSON.parse(raw);
  if (!isRecord(obj) || typeof obj.retries !== "number") {
    throw new ConfigError("config.retries must be a number");
  }
  return { retries: obj.retries };
}
```
