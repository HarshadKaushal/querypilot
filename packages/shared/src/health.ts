// The shape of GET /health/ready, shared so tests and monitoring read the same fields.

export interface DependencyCheck {
  status: 'up' | 'down';
  latencyMs: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: {
    appDatabase: DependencyCheck;
    redis: DependencyCheck;
  };
}
