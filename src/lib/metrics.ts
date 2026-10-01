export type PushMetricKey =
  | "pushes_received"
  | "pushes_acknowledged"
  | "duplicates_ignored"
  | "stale_notifications_ignored"
  | "jobs_created"
  | "notifications_coalesced"
  | "active_sync_jobs"
  | "persistence_failures"
  | "circuit_breaker_activations"
  | "gmail_api_requests"
  | "worker_duration_ms"
  | "auth_expired_accounts";

export class TelemetryCollector {
  private counters = new Map<PushMetricKey, number>();

  increment(key: PushMetricKey, amount = 1) {
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  get(key: PushMetricKey): number {
    return this.counters.get(key) ?? 0;
  }

  getAll(): Record<PushMetricKey, number> {
    const keys: PushMetricKey[] = [
      "pushes_received",
      "pushes_acknowledged",
      "duplicates_ignored",
      "stale_notifications_ignored",
      "jobs_created",
      "notifications_coalesced",
      "active_sync_jobs",
      "persistence_failures",
      "circuit_breaker_activations",
      "gmail_api_requests",
      "worker_duration_ms",
      "auth_expired_accounts",
    ];
    const result: Partial<Record<PushMetricKey, number>> = {};
    for (const key of keys) {
      result[key] = this.counters.get(key) ?? 0;
    }
    return result as Record<PushMetricKey, number>;
  }

  reset() {
    this.counters.clear();
  }
}

export const telemetry = new TelemetryCollector();
