import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { APP_ENV, type CoreEnv } from '../config/env';

/** BullMQ events that change what a job's owner sees. */
const EVENTS = ['active', 'progress', 'completed', 'failed', 'delayed'] as const;

export type JobEventType = (typeof EVENTS)[number];

/**
 * Tells listeners when a job changes, whichever worker runs it. One BullMQ QueueEvents
 * stream per process, opened on the first subscription, fans out by job id. Listeners
 * re-read the job rather than trust the event, so a missed or repeated event is harmless.
 */
@Injectable()
export class JobEvents implements OnModuleDestroy {
  private connection?: Redis;
  private events?: QueueEvents;
  private ready?: Promise<void>;
  private readonly listeners = new Map<string, Set<(type: JobEventType) => void>>();

  constructor(@Inject(APP_ENV) private readonly env: CoreEnv) {}

  /** Calls listener on every change to the job until the returned function is called. */
  async subscribe(
    jobId: string,
    listener: (type: JobEventType) => void,
  ): Promise<() => void> {
    await this.start();
    const set = this.listeners.get(jobId) ?? new Set();
    set.add(listener);
    this.listeners.set(jobId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(jobId);
      }
    };
  }

  private start(): Promise<void> {
    this.ready ??= (async () => {
      // QueueEvents blocks on a Redis stream, so it needs its own connection that retries.
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
      this.events = new QueueEvents(this.env.JOB_QUEUE_NAME, {
        connection: this.connection,
      });
      for (const type of EVENTS) {
        this.events.on(type, (args: { jobId: string }) => this.emit(args.jobId, type));
      }
      await this.events.waitUntilReady();
    })();
    return this.ready;
  }

  private emit(jobId: string, type: JobEventType): void {
    for (const listener of this.listeners.get(jobId) ?? []) {
      listener(type);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.events?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
