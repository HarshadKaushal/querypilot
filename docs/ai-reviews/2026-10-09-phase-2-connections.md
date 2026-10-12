# AI review: Phase 2 connections

Date: 2026-10-09

## What changed

Envelope encryption, an SSRF package, connection routes, a read-only probe, the egress meta route, and TLS on the sample database.

## What was checked

- Unit tests seal a password and assert the stored row, the public DTO, and the audit JSON do not contain it.
- Private and metadata answers return `SSRF_BLOCKED`. Metadata stays blocked when private addresses are allowed.
- `disable` returns `SSL_REQUIRED` before any socket is opened.
- A fake probe that reports a write-capable role returns `NOT_READ_ONLY`. The probe's own tests cover superuser, INSERT, and an SSL error that must not echo the driver string.
- A second user's id returns `NOT_FOUND`. A label change does not call the probe again.
- A failed retest sets `failing` and still omits the password from audit metadata.
- `loadEnv` rejects `SSRF_ALLOW_PRIVATE=true` in production and does not print the value.
- IPv6 `BlockList` checks pass an explicit address family. On this Node build, inference alone treated `::` and `fe80::1` as allowed.

## Decisions

- The probe lives in the executor module now, so user-database sockets have one owner before pooling exists.
- Local sample access uses `SSRF_ALLOW_PRIVATE`, refused in production. The host name to use from the laptop is `127.0.0.1`, port `5433`. Inside Compose it is `sample-db`, port `5432`.
- Rewrap rotates the data-key wrap only. An earlier draft resealed with a new data key and then copied the old password ciphertext, which cannot be opened. The tests now open the rotated row and fail a v1-only ring.

## Still open

- Schema introspection, allowlists, and the SQL guard are Phase 3 and Phase 4.
- The executor does not run user SQL, pool, or cap rows.
- `EGRESS_IP` is a stand-in until a NAT gateway exists.
- A live probe of `sample_ro` versus `sample_admin` depends on the rebuilt sample container. Unit tests do not open that socket.
