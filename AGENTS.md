# Plugin copy

- Write all authored plugin copy in English, including display names, descriptions,
  starter prompts, command hints, style labels, instructions, examples and diagnostics.
- Never use em dashes in authored plugin text. Use a period, comma, colon or
  parentheses. Do not substitute encoded em dashes.
- Preserve installation IDs, existing command/tool identifiers and legacy aliases.
  Use English labels in the UI and documentation without breaking saved settings.
- Multilingual input dictionaries and test fixtures are functional data, not UI
  copy. Preserve their behavior. Do not translate third-party license notices.
- Run `npm run validate:copy` and `npm test` before submitting changes. The copy
  check catches punctuation and known Spanish regressions, not every language.
  Review all new prose for English manually as well.
- Changed plugin payloads must be versioned and signed with the existing publisher
  key before release. Never commit or print a private signing key.
