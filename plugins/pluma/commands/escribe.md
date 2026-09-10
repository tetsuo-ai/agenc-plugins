---
aliases: [escribe]
description: Write in a formal, warm, concise, persuasive, or technical voice, or a complete document form, with deterministic lint checks before delivery
argument-hint: "<style> <request or text>"
---

Follow the skill in `skills/escritura/SKILL.md` and its boundaries.

Recognize these canonical styles in the first argument: formal, warm,
concise, persuasive, technical, formal-letter, professional-email, speech,
proposal, cover-letter. Accept legacy style IDs through the linter's
compatibility aliases. Remaining arguments contain the writing request
or text to restyle.

1. Confirm an ambiguous style with at most one short question.
2. Draft using its output-style definition.
3. Run `style_lint`, revise findings, and recheck. Stop after two revision
   passes and explain any unresolved choice to the user.
4. Deliver the text and one line with style, score, and changes.
5. Suggest `/output-style` for a continuing session-wide voice.

If no style is specified, suggest the two most likely choices in one line
and use the better fit if the user does not answer.
