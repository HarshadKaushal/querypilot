# @ayd/crypto

Envelope encryption for the username and password of a customer's database (ADR 0007).

**How it works**

1. Each connection gets its own random data key, which encrypts the username and the password (AES-256-GCM).
2. A master key from `CRYPTO_MASTER_KEYS` encrypts ("wraps") that data key.
3. Only ciphertext, IVs, tags, and the master key's version are stored.

A stolen copy of the app database is therefore useless without the master key. Rotating the master key means re-wrapping the small data keys (`rewrapCredentials`), not re-encrypting every password. The job that would do that is not built yet.

**Everything is in** `src/index.ts`: `parseMasterKeyRing`, `sealCredentials`, `openCredentials`, and `rewrapCredentials`.

**Commands:** `npm run test:unit -w @ayd/crypto`.
