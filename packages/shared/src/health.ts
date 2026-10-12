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
