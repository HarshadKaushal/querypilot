# ADR 0002: Redis for queue, limits, and cache

Redis is the shared store for the job queue, rate limits, connection semaphores, and short-lived caches. BullMQ, the queue chosen in the blueprint, runs on Redis. One instance is enough while a single API and a single worker are the whole system. Split queue and cache into separate Redis databases when they contend. Do not introduce a second broker.
