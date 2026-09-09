---
name: olimpiada
description: The IMO corpus with guided problem solving — historic olympiad problems (1959–2000s classics) with statement, hint ladder, key idea and full solution, retrieved on demand. Designed to run well on small local models: the corpus carries the truth, the model carries the reasoning. Use for math olympiad practice, explaining famous problems, tutoring, or studying techniques (Vieta jumping, invariants, EGZ, Sophie Germain…).
when_to_use: The user wants olympiad problems, math practice, to understand a famous IMO problem, to study a technique, or asks "explain like the IMO does" for competition math.
argument-hint: [problema|practica|tecnica]
---

# Olimpiada — la verdad en el corpus, el razonamiento en el modelo

Este skill está diseñado para correr bien en modelos chicos (Qwen 27B/30B
y familia). La regla que lo hace posible: **el corpus tiene la verdad
(enunciados, hints, ideas clave, soluciones completas); vos tenés el
razonamiento y la explicación**. Nunca intentes recordar un problema
IMO de memoria: recuperálo con las tools y explicá lo recuperado.

## Protocolo de práctica

1. **Selección** — `study_plan` para una sesión (tema opcional) o
   `problem_random` para uno suelto. Si el usuario nombra un problema
   ("el famoso del 88"), `problem_search` y confirma el id con él.
2. **Enunciado** — `problem_get` nivel `statement`. Presentalo limpio,
   con año, número, tema y dificultad.
3. **Intento socrático** — dejá que el usuario intente. Si se traba,
   `problem_get` nivel `hint1` y ofrecé UN hint formulado como pregunta.
   Subí de a uno: `hints` recién cuando pidió más.
4. **Verificación** — si el problema tiene respuesta corta (campo
   answer), `answer_check` con lo que respondió: determinista, sin
   interpretación tuya. Si es de demostración, la verificación es leer
   la solución y comparar paso a paso.
5. **Solución** — `problem_get` nivel `solution` solo cuando falló o la
   pidió. Presentala por PASOS: una idea por bloque, citando la idea
   clave (`keyIdea`) como mapa antes de los detalles. Si
   `solutionType` es "sketch", DECÍLO — un sketch no es una
   demostración completa y el usuario debe saberlo.
6. **Cierre** — `progress_mark` (attempted/solved/learning + nota) y
   sugerí el próximo según el plan.

## Protocolo de explicación

Cuando el usuario pregunta por un problema o técnica histórica:
1. Recuperá el problema con las tools (nunca de memoria).
2. Explicá en capas: contexto histórico (sourceNote) → por qué es
   difícil → idea clave en una frase → demostración por pasos.
3. Conectá con las tags: "Vieta jumping" tiene su hogar en 1988-6;
   Sophie Germain en 1969-1; el invariante monovariante en 1986-3.
   `problem_search` por tag arma la lección completa de una técnica.

## Reglas de oro para modelos chicos

- Una idea por oración al explicar; verificá tu aritmética con
  `answer_check` cuando haya answer — no confíes en tu cálculo mental.
- Si no encontrás un problema en el corpus, decilo: "no está en el
  corpus todavía" y ofrecé resolverlo desde cero con el usuario,
  marcando que es razonamiento tuyo sin verificación histórica.
- Los tools son entradas deferidas: buscalos con tu tool search
  (`system.searchTools`) con "olimpo" antes del primer uso.
