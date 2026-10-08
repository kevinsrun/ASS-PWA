export class PushIdempotencyCache {
  private seenNotifications = new Map<string, number>();
  private newestHistoryPerEmail = new Map<
    string,
    { historyId: bigint; timestamp: number }
  >();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 2000;
    this.ttlMs = options?.ttlMs ?? 15 * 60_000;
  }

  isDuplicate(notificationId: string): boolean {
    const seenAt = this.seenNotifications.get(notificationId);
    if (!seenAt) return false;
    if (Date.now() - seenAt > this.ttlMs) {
      this.seenNotifications.delete(notificationId);
      return false;
    }
    return true;
  }

  isStale(email: string, historyIdStr: string): boolean {
    const existing = this.newestHistoryPerEmail.get(email.toLowerCase());
    if (!existing) return false;
    if (Date.now() - existing.timestamp > this.ttlMs) {
      this.newestHistoryPerEmail.delete(email.toLowerCase());
      return false;
    }
    try {
      return BigInt(historyIdStr) <= existing.historyId;
    } catch {
      return false;
    }
  }

  record(notificationId: string, email: string, historyIdStr: string) {
    if (this.seenNotifications.size >= this.maxEntries) {
      const oldestKey = this.seenNotifications.keys().next().value;
      if (oldestKey) this.seenNotifications.delete(oldestKey);
    }
    this.seenNotifications.set(notificationId, Date.now());

    try {
      const parsed = BigInt(historyIdStr);
      const key = email.toLowerCase();
      const existing = this.newestHistoryPerEmail.get(key);
      if (!existing || parsed > existing.historyId) {
        this.newestHistoryPerEmail.set(key, {
          historyId: parsed,
          timestamp: Date.now(),
        });
      }
    } catch {
      // Ignore BigInt parse errors
    }
  }

  getCursor(email: string): string | null {
    const existing = this.newestHistoryPerEmail.get(email.toLowerCase());
    return existing ? existing.historyId.toString() : null;
  }

  reset() {
    this.seenNotifications.clear();
    this.newestHistoryPerEmail.clear();
  }
}

export const pushIdempotencyCache = new PushIdempotencyCache();
