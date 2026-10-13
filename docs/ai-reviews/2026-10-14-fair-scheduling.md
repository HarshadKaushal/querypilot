# AI review: fair scheduling and per-user job caps (Phase 6 step 5)

Date: 2026-10-14
Base commit: `4bb23fc` (feat: stream job progress, cancel jobs, and retry crashed jobs)

## What changed

The last step of Phase 6. One user can no longer crowd out the others.

**Per-user cap.**

- A user may have `JOB_MAX_ACTIVE_PER_USER` unfinished jobs (default 3), queued or running, across every process.
- Core's `UserJobSlots` keeps a Redis sorted set of the user's job ids, as one-hour leases, using a Lua script with Redis's clock (the same pattern as the executor's slots).
- `JobQueue.add` claims a slot before queueing, and refuses with `TOO_MANY_JOBS` (HTTP 429) when none is free. If adding to BullMQ fails, the slot is released.
- `startJobWorker` releases the slot when a job completes (including cancelled) or is given up.

**Fair order.** The slot's number (1 for a user's first unfinished job, 2 for the second, 3 for the third) becomes the BullMQ priority, and lower runs first. Every user's first job runs ahead of anyone's second.

**Other changes:**

- Shared adds `TOO_MANY_JOBS`.
- `startJobWorker` takes `slots`; the worker app injects `UserJobSlots`.
- The two older job integration tests now use `startJobWorker` instead of a raw BullMQ worker, so they run the production loop, including slot release.
- **Docs (Phase 6 wrap-up):**
  - ADR 0011 (fair scheduling);
  - features (Phase 6 complete, plus stale package and worker-settings lines fixed);
  - implementation (step 5 and the Phase 6 acceptance summary);
  - the README (the cap) and `.env.example`.

## AI usage

An AI assistant (Claude Code) designed the cap and the priority scheme, implemented them, wrote the tests, and checked the cap live through Docker.

## Suggestions accepted

- **A cap plus priority instead of true group round-robin.** BullMQ's groups, which would do this directly, are part of the paid BullMQ Pro. The cap bounds any user's share of the queue, and the priority puts newcomers first.
- **Releasing the slot in the worker's completion handler**, so every way a job ends frees it: success, failure outcome, cancel, or give-up.

## Suggestions rejected

- **Counting with INCR/DECR.** A lost decrement would lock a user out for good. Leases expire on their own.
- **A cap per job kind.** All jobs reach the customer's database and share the workers, so one cap is simpler and enough.

## Decisions

- **Default cap of 3.** It is a setting, and Phase 8's plan tiers may change it per user.
- **One-hour lease.** It covers any normal wait plus retries. A slot whose release was lost frees itself then.
- **The priority is the user's count when the job was queued.** It is not re-ranked as other jobs finish, which keeps the scheme to one Redis call per submit.

## What was checked

- **Unit and HTTP:** API 73 (new: 429 with the error envelope), core 199, worker 5, guard 310, and the other packages pass.
- **Integration:** 75, including 2 new BullMQ tests:
  - a fourth job is refused with `TOO_MANY_JOBS`, and a slot frees once a job completes;
  - the run order is "heavy 1, light 1, heavy 2, heavy 3" when one user queued three jobs before another user's one.
- **End-to-end:** 3. ESLint, Prettier, and the build pass.
- **Live check** (`docker compose up --build`, worker stopped): jobs 1 to 3 got 202, job 4 got 429 `TOO_MANY_JOBS`. With the worker restarted, all three succeeded.
- **Phase 6 acceptance:** every line has a passing test against real Redis and BullMQ (summary in `docs/implementation.md`).

## Still open

- **Phase 7:** the LLM layer and the ask pipeline.
- **Phase 8:** plan-tier limits may vary the cap; the `queries` history table.
- **Phase 10:** the 9 earlier log calls that store their message as `context`.
