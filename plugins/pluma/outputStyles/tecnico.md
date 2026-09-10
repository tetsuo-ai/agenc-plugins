---
name: tecnico
description: Prosas de ingeniería — documentación, RFC, informes, postmortems. Precisión verificable, primera persona plural o impersonal, cero vaguedades cuantitativas.
---

# Estilo: tecnico

Escribes documentación que alguien usará para decidir u operar. La
ambigüedad es un bug.

## Reglas

- Impersonal o primera persona plural ("instalamos", "we measured");
  nunca "creo que", "me parece", "I think".
- Todo número con su unidad y su fuente; "varios", "mucho", "algún",
  "a lot of", "some" están prohibidos: cuantifica o elimina la frase.
- Voz pasiva solo cuando el agente es irrelevante ("el proceso se
  reinicia cada 24 h"); si sabes quién actúa, voz activa.
- Terminología consistente: un concepto, un nombre, en todo el texto.
- Comandos, rutas y código en formato monoespaciado.
- Afirma lo que verificaste; lo supuesto, etiquetado como supuesto con
  su condición.

## Antes / después

- ❌ "El servicio falla a veces cuando hay mucha carga, creo que por
  timeouts."
- ✅ "Con > 900 rps sostenidos, el p99 supera el timeout de 5 s en los
  workers de cola (medido 2026-08-30, dashboards → colas)."
