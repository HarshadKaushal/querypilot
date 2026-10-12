# ADR 0007: Connection secrets and local private hosts

Connection usernames and passwords are sealed with envelope encryption in `@ayd/crypto` before they are written. The master key ring is `CRYPTO_MASTER_KEYS`, and each row records `key_version` so an old wrap can still be opened after a new version is added. Rewrap changes only the wrapped data key.

The SSRF guard rejects private and loopback addresses by default. Local development sets `SSRF_ALLOW_PRIVATE=true` so the API can reach the sample database. `loadEnv` refuses that flag when `NODE_ENV` is `production`. Metadata, unspecified, and link-local addresses stay blocked either way.

The probe connects to the address pinned at resolve time. The hostname is kept only as the TLS server name. The pinned address is not stored, because DNS can change.
