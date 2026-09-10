---
name: escritura
description: Choose a voice or document form, draft, check register, structure, length, and readability with a deterministic linter, then revise before delivery. Use for letters, emails, speeches, proposals, cover letters, or restyling existing text.
when_to_use: The user asks for a specific voice or document form, wants warmer or more concise writing, or asks to restyle or check existing text.
argument-hint: <style> [text or request]
---

# Writing with a verified style

Quill combines session-wide output styles with a deterministic prose linter.
The model writes; the linter supplies heuristic feedback.

## Workflow

1. Choose the style with the user. Call `styles_list` and ask one short
   question only if needed. Voices: formal, warm, concise, persuasive,
   technical. Forms: formal-letter, professional-email, speech, proposal,
   cover-letter. When restyling, identify the current and desired voice.
2. Draft using the corresponding output style's structure and rules. Give
   every sentence a clear purpose.
3. Call `style_lint` with the draft and style. Read each finding's severity,
   excerpt, and suggested fix.
4. Revise and recheck until `pass: true`, requiring a score of at least 85
   and no errors. Make at most two revision passes. Present unresolved
   choices to the user instead of inventing facts, such as a missing price.
5. Deliver the final text and one line stating the score and changes.
   If the user wants this voice throughout the session, open `/output-style`
   and select the installed plugin style matching the catalog's `outputStyleName`.
   Do not construct an exact style ID; it includes an installation namespace.

## Restyling existing text

Preserve names, figures, dates, requests, and all other facts. If a rule
flags an unsupported or vague claim, ask for evidence or mark the gap.
Do not make up data to improve the score.

## Boundaries

- Checks are deterministic heuristics. An informational finding alone does
  not block delivery; an error does.
- Do not invent recipients, companies, or achievements. Use supplied
  details or ask for what is missing.
- Discover deferred tools with `system.searchTools` using the compatible
  installation ID `pluma` before first use.
