# @ayd/ssrf-guard

Stops a user from pointing a "database connection" at our own network (server-side request forgery, ADR 0007).

The caller resolves the host first and passes every address it got; `assessResolution()` then decides.

- **Always refused:** cloud metadata addresses, link-local, unspecified, and names such as `localhost` or `*.internal`.
- **Refused unless `SSRF_ALLOW_PRIVATE` is on:** loopback and private ranges. Only local development turns that on, and production refuses it.
- **Mixed answers:** one bad address rejects the host.

When the host is allowed, the result names the one address to connect to (`pinnedAddress`). Connecting to that exact address means a second DNS lookup cannot swap in another one.

**Everything is in** `src/index.ts`. **Commands:** `npm run test:unit -w @ayd/ssrf-guard`.
