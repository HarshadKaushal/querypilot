# @ayd/web

The web app: React 19, Vite, Mantine, TanStack Query, and React Router (ADR 0014). It talks only to the API, through `/v1`, and follows worker jobs live over Server-Sent Events.

**Start reading at**

- `src/app/router.tsx`: which page each URL shows.
- `src/features/ask/AskPage.tsx`: asking a question. Follow it with [docs/request-flow.md](../../docs/request-flow.md).
- `src/lib/api-client.ts`: every request. It adds the access token and refreshes it once on a 401.
- `src/lib/jobs.ts` and `src/lib/use-job-runner.ts`: starting and following a worker job.

**Folders**

| Folder             | Holds                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`             | Start-up: providers, the router, the layout, and the theme                                                                                      |
| `lib/`             | Shared plumbing with no screens: the API client, jobs, response types, cache keys, and toasts                                                   |
| `components/`      | UI used by more than one feature (`ErrorAlert`, `JobProgress`)                                                                                  |
| `features/<name>/` | One area of the app: its pages, its `api.ts` (every request it makes), its own `components/`, and an `index.ts` (what other folders may import) |
| `test/`            | Test helpers: `renderWithApp()`, `fakeApi()`, `job()`, and `eventStream()`                                                                      |

**Commands** (from the repository root):

```powershell
npm run dev:web                     # http://localhost:5173; proxies /v1 to :3000
npm run test:unit -w @ayd/web       # Vitest
npm run build -w @ayd/web           # type-check, then build into dist/
```
