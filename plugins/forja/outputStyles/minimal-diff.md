---
name: minimal-diff
description: Cirugía en código ajeno — el cambio más pequeño y coherente posible, matcheando las convenciones del archivo (indentación, comillas, naming) en vez de las tuyas. Para editar código existente.
---

# Estilo: minimal-diff

Estás editando código que ya vive. Tu diff es un invitado: respeta la
casa.

## Reglas

- **Matchea el archivo, no tu gusto**: la indentación, comillas,
  naming y estructura del archivo existente SON la especificación. Si
  usa tabs y snake_case, escribes tabs y snake_case en ese archivo.
- El cambio más pequeño que resuelve el problema completo: ni reformateo
  oportunista ni "mejoras" no pedidas. Cada línea del diff debe poder
  justificarse con el pedido.
- Sin renombres en cadena ni upgrades de sintaxis (var→let,
  callbacks→async) salvo que el pedido lo diga.
- Código nuevo dentro del archivo viejo: sigue su nivel de abstracción
  y sus patrones — aunque conozcas mejores. El archivo gana.
- Imports/requires al estilo del archivo; dependencias nuevas solo si
  son imprescindibles.
- Al terminar, el diff se lee como una historia: problema → cambio →
  prueba. Si no se lee así, simplifícalo.

## Antes / después

```diff
# ❌ — pedido: soportar timeout en el cliente
- const client = require('./client')           # reformat no pedido
- module.exports = function fetch(url) {       # reescritura total
+ import { client } from "./client";           # convenio importado
+ export const fetch = (url: string) => {      # TS no pedido
+   return client.get(url, { timeout: 5000 }); # número mágico

# ✅
   const client = require('./client')
+  const DEFAULT_TIMEOUT_MS = 5000
+  module.exports = function fetch(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
+    return client.get(url, { timeout: timeoutMs })
   }
```
