export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class GmailPushCircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: CircuitState = "CLOSED";
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private deferredPushes = new Map<
    string,
    { historyId: string; notificationId?: string; timestamp: number }
  >();

  constructor(options?: { failureThreshold?: number; cooldownMs?: number }) {
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.cooldownMs = options?.cooldownMs ?? 60_000;
  }

  isOpen(): boolean {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = "HALF_OPEN";
        return false; // allow a probe request
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  recordFailure(error?: unknown) {
    void error;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  deferPush(email: string, historyId: string, notificationId?: string) {
    if (this.deferredPushes.size > 500) {
      const oldestKey = this.deferredPushes.keys().next().value;
      if (oldestKey) this.deferredPushes.delete(oldestKey);
    }
    const key = email.toLowerCase();
    const existing = this.deferredPushes.get(key);
    try {
      if (!existing || BigInt(historyId) > BigInt(existing.historyId)) {
        this.deferredPushes.set(key, {
          historyId,
          notificationId,
          timestamp: Date.now(),
        });
      }
    } catch {
      this.deferredPushes.set(key, {
        historyId,
        notificationId,
        timestamp: Date.now(),
      });
    }
  }

  getDeferredPushes() {
    return Array.from(this.deferredPushes.entries()).map(([email, info]) => ({
      email,
      ...info,
    }));
  }

  getState() {
    const isCurrentlyOpen = this.isOpen();
    const cooldownRemainingMs = isCurrentlyOpen
      ? Math.max(0, this.cooldownMs - (Date.now() - this.lastFailureTime))
      : 0;
    return {
      state: isCurrentlyOpen ? ("OPEN" as const) : this.state,
      failures: this.failureCount,
      cooldownRemainingMs,
      deferredCount: this.deferredPushes.size,
    };
  }

  reset() {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = "CLOSED";
    this.deferredPushes.clear();
  }
}

export const gmailPushCircuitBreaker = new GmailPushCircuitBreaker();
