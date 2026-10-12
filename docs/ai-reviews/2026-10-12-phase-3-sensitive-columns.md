# AI review: schema document type and sensitive-column hint

Date: 2026-10-12
Base commit: `2a19974` (feat(schema): add tables for schema snapshots and the allowlist)

## What changed

Second slice of Phase 3.

- `schema/schema-document.ts` defines the JSON a snapshot stores: tables with schema, name, kind, columns (name, type, nullable), primary key, and foreign keys. It has a `formatVersion` so a later change of shape can be detected.
- `schema/sensitive-columns.ts` decides whether a column starts hidden on the first snapshot. It splits a name into words and matches whole words or word sequences for personal data (email, phone, address, national ids, date of birth, card and bank numbers) and credentials (password, token, secret, API key, OTP, CVV).

## AI usage

An AI assistant (Claude Code) wrote both files and the test table. The blueprint names the categories (emails, phone numbers, tokens, national IDs). The assistant chose the word lists and the type rules below. The developer chose to hide sensitive columns by default as part of the Phase 3 picks.

## Suggestions accepted

- Match whole words, not substrings. A substring search for `taxid` flags `syntax_identifier`, and `pan` would flag `company`.
- Never flag a `boolean` column. `email_opt_in` and `has_phone` cannot hold the value itself.
- Flag credential words only on non-numeric columns. `tokens_used` and `password_attempts` are counters. Personal words still flag numeric columns, because a phone number or SSN is often stored as a number.
- Include Indian identifiers (Aadhaar, PAN) alongside SSN and passport.

## Suggestions rejected

- Inspecting cell values to detect emails or phone numbers. Reading rows is outside Phase 3's pass-through rule; the hint uses names and types only.
- Flagging `pin` or `pin_code`. In India a PIN code is a postal code, which the analytics questions need.
- Flagging `city`, `region`, and `country`. They are coarse enough for aggregate questions, and the sample data's regions depend on them.

## Decisions

- The hint is advisory. The user can allow a flagged column, and the ADR says so.
- `address` alone is flagged, which also covers `ip_address` and `email_address`.

## What was checked

- 53 table-driven unit cases, one line each: 31 that must be flagged and 22 that must not, including the false-positive guards above, plus word-splitting cases for snake case, camel case, and acronyms.

## Still open

- Nothing calls the hint yet. The refresh service uses it in a later slice.
