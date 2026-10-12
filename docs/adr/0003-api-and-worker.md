# ADR 0003: API and worker are separate processes

The API accepts a question and returns a job id. The worker calls the model and the user's database. A slow query must not occupy the process that serves health checks and sign-in. The two processes scale on different signals: request count for the API, queue depth for the worker. User databases are reached only from the worker, through one egress address.
