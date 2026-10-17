# @ayd/shared

The few types and helpers that both the server and its clients need. It has no dependencies, so the web app can import it too.

- `src/errors.ts`: every error code (`ERROR_CODES`) and the error envelope, `{ error: { code, message, requestId } }`.
- `src/request-id.ts`: the `x-request-id` rule (reuse a safe id, otherwise make one).
- `src/health.ts`: the shape of `GET /health/ready`.

Add an error code here before any code returns it.

**Commands:** `npm run test:unit -w @ayd/shared`.
