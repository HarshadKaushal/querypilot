import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** Workers subscribe here; the message is the id of the job to cancel. */
export const CANCEL_CHANNEL = 'ayd:jobs:cancel';

export function cancelKey(jobId: string): string {
  return `ayd:jobs:cancel:${jobId}`;
}

// The key catches a job still waiting: the worker checks it before starting. The message
// reaches a job already running: the worker holding it aborts its signal. A day covers any
// wait in the queue.
const REQUEST = `
redis.call('SET', KEYS[1], '1', 'EX', 86400)
redis.call('PUBLISH', ARGV[1], ARGV[2])
return 1`;

const REQUESTED = `return redis.call('EXISTS', KEYS[1])`;

/** Cancellation requests, shared by the API and every worker through Redis. */
@Injectable()
export class JobCancellation {
  constructor(private readonly redis: RedisService) {}

  async request(jobId: string): Promise<void> {
    await this.redis.run(REQUEST, [cancelKey(jobId)], [CANCEL_CHANNEL, jobId]);
  }

  async requested(jobId: string): Promise<boolean> {
    return (await this.redis.run(REQUESTED, [cancelKey(jobId)], [])) === 1;
  }
}
