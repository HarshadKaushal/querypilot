# AI review: record failed address lookups, no IP as TLS server name, blueprint table names

Date: 2026-10-12
Base commit: `25cb7df` (feat(sample-db): add schemas to the sample database and document Phase 3)

One commit for three small fixes, following the developer's request to bundle small fixes.

## What changed

1. **Failed address lookups are recorded.** `ConnectionService.test()` and the schema refresh looked up the host before anything was recorded. A host that no longer resolved, or now resolved to a blocked address, returned an error but left the connection `active` with no audit row. `resolveTarget` now returns that failure instead of throwing it, and both callers record it like a failed probe: `status: failing`, plus a `connection.tested` or `schema.refreshed` audit row with `result: failed`. A connection the user does not own still throws `NOT_FOUND`, because there is nothing to record on.
2. **No IP address as the TLS server name.** The probe always sent the connection's host as the TLS server name (SNI). When the user entered an IP address, that put an IP where RFC 6066 allows only a host name, and Node warned that a future version will ignore it. The probe now sends a server name only for host names. For an IP, the certificate is checked against the IP itself, which is the pg driver's own default.
3. **Blueprint table names.** An editor's Markdown formatter turned `refresh\_tokens` and five other escaped names into `refreshtokens`, `schemasnapshots`, `allowedobjects`, `querycache`, `usagecounters`, and `auditlog`. They are restored as plain `refresh_tokens` and so on, without the backslash, because an underscore inside a word needs no escape and gives a formatter nothing to strip. The developer's own blueprint changes are kept: "Rules for the Implementer (Claude)" and the table alignment.

## AI usage

An AI assistant (Claude Code) found problems 1 and 2 during earlier work and noticed the damaged names while checking `git status`. It explained each one, and the developer chose these fixes. The assistant wrote the code, the tests, and this file. The blueprint edit itself (the rename and the formatting) was the developer's.

## Suggestions accepted

- Return a lookup failure from `resolveTarget` as a value, so each caller records it next to its existing probe-failure path.
- Treat a host that now resolves to a blocked address as a failed test. It is unusable either way.
- Restore the names without backslash escapes.

## Suggestions rejected

- Catching every error in `test()` and marking the connection failing. A `NOT_FOUND` for someone else's connection must not touch that row, and an unexpected error should surface as one.
- Keeping the IP as the server name and silencing the Node warning. The warning points at real non-compliance, and a future Node would drop the value anyway.

## Decisions

- Lookup failures keep their existing codes and messages (`CONNECTION_FAILED`, `SSRF_BLOCKED`). Only the recording changed.
- For `require` mode nothing else changes. Certificates are not verified there, and SNI only selects which certificate the server presents.

## What was checked

- Unit tests: 162 in the API. Three new tests (a retest whose host no longer resolves, one that now resolves to a private address, and a refresh whose host no longer resolves) fail on the code before this commit and pass now. Two new tests check the TLS options: a host name is sent as the server name; an IPv4 or IPv6 address is not.
- Live, against the sample database over SSL: the probe connected both with the host entered as `127.0.0.1` and as `localhost`, and Node printed no deprecation warning. Before this change the IP case printed one.
- Integration (28) and end-to-end (3) tests, ESLint, Prettier, and the full build pass.

## Still open

None from this set.
