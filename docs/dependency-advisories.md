# Accepted dependency advisories

`npm audit` findings that are known and deliberately left in place. Each one says why it is safe here and when to look again. Re-run `npm audit` before a release and whenever Prisma or Jest is upgraded.

| Package              | Severity                                                | Pulled in by                                                                                        | Why it is accepted                                                                                                                                               | Revisit when                                                                     |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `deepmerge-ts` < 8   | High (stack exhaustion on a self-referencing object)    | `prisma` CLI → `@prisma/config`                                                                     | Merges only our own Prisma configuration, when `prisma generate` or `prisma migrate` runs. No user request reaches it, and the API never calls it while serving. | A `prisma` release depends on `deepmerge-ts` 8 or later. Upgrade Prisma then.    |
| `sprintf-js` ≤ 1.1.3 | Moderate (CPU and memory on a huge precision specifier) | Jest coverage: `babel-plugin-istanbul` → `@istanbuljs/load-nyc-config` → `js-yaml` 3 → `argparse` 1 | Runs only during tests and reads only our own config files. No fixed version of `sprintf-js` exists.                                                             | Jest's coverage tooling drops `js-yaml` 3, or a fixed `sprintf-js` is published. |

Accepted on 2026-10-12. Every other advisory npm listed then was one of these two, reported again through each package that depends on it.

## Fixes tried and not used

- `npm audit fix` changed only `babel-plugin-istanbul` and cleared nothing.
- An npm `overrides` entry forcing `deepmerge-ts` 8 under `@prisma/config` did not take effect while the lockfile pinned 7.1.5. With those lockfile entries removed, npm deleted Prisma's config packages instead of upgrading them, which breaks `prisma generate` and container start-up. The tree was restored from the committed lockfile.
- `npm audit fix --force` would downgrade Prisma (6.19 to 6.12) and ts-jest. Not used.
