import { NextRequest, NextResponse } from "next/server";
import {
  decodeGmailPush,
  gmailPushCircuitBreaker,
  gmailPushConfiguration,
  persistGmailPush,
  pushIdempotencyCache,
  telemetry,
  validateGmailPush,
} from "@/lib/gmailPush";
import { requestId, structuredLog } from "@/lib/structuredLog";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const correlationId = requestId(request.headers);
  const started = Date.now();

  if (!gmailPushConfiguration().ready) {
    return NextResponse.json(
      { error: "Gmail push configuration is incomplete" },
      { status: 503 },
    );
  }

  try {
    await validateGmailPush(request.headers.get("authorization"));
  } catch {
    return NextResponse.json(
      { error: "Invalid Pub/Sub identity" },
      { status: 401 },
    );
  }

  let notification: ReturnType<typeof decodeGmailPush>;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    notification = decodeGmailPush(JSON.parse(raw));
  } catch (error) {
    structuredLog("warn", {
      subsystem: "gmail_push",
      event: "payload_rejected",
      request_id: correlationId,
      message:
        error instanceof Error ? error.message : "Invalid Gmail notification",
    });
    // Deterministically acknowledge and drop poison messages so they do not loop forever
    return NextResponse.json(
      {
        accepted: false,
        dropped: true,
        error: error instanceof Error ? error.message : "Invalid Gmail notification",
        requestId: correlationId,
      },
      { status: 200 },
    );
  }

  telemetry.increment("pushes_received");
  structuredLog("info", {
    subsystem: "gmail_push",
    event: "gmail_push_received",
    request_id: correlationId,
    notification_id: notification.notificationId,
    email: notification.email,
    history_id: notification.historyId,
  });

  // Fast-path 1: Exact duplicate Pub/Sub message ID within TTL
  if (pushIdempotencyCache.isDuplicate(notification.notificationId)) {
    telemetry.increment("duplicates_ignored");
    telemetry.increment("pushes_acknowledged");
    structuredLog("info", {
      subsystem: "gmail_push",
      event: "gmail_push_duplicate",
      request_id: correlationId,
      notification_id: notification.notificationId,
      history_id: notification.historyId,
      email: notification.email,
      duration_ms: Date.now() - started,
    });
    return NextResponse.json({
      accepted: true,
      duplicate: true,
      requestId: correlationId,
    });
  }

  // Fast-path 2: Stale notification with historyId <= already seen newest cursor
  if (pushIdempotencyCache.isStale(notification.email, notification.historyId)) {
    telemetry.increment("stale_notifications_ignored");
    telemetry.increment("pushes_acknowledged");
    structuredLog("info", {
      subsystem: "gmail_push",
      event: "gmail_push_stale",
      request_id: correlationId,
      notification_id: notification.notificationId,
      history_id: notification.historyId,
      email: notification.email,
      duration_ms: Date.now() - started,
    });
    return NextResponse.json({
      accepted: true,
      stale: true,
      requestId: correlationId,
    });
  }

  // Circuit Breaker: When persistence is known failing, signal retryable 503 so Pub/Sub retains redelivery ownership
  if (gmailPushCircuitBreaker.isOpen()) {
    telemetry.increment("circuit_breaker_activations");
    structuredLog("warn", {
      subsystem: "gmail_push",
      event: "gmail_push_circuit_open",
      request_id: correlationId,
      notification_id: notification.notificationId,
      history_id: notification.historyId,
      email: notification.email,
      duration_ms: Date.now() - started,
    });
    return NextResponse.json(
      {
        accepted: false,
        error: "Persistence circuit breaker open; Pub/Sub retry required",
        requestId: correlationId,
      },
      {
        status: 503,
        headers: { "Retry-After": "30" },
      },
    );
  }

  try {
    const result = await persistGmailPush(notification, correlationId);
    pushIdempotencyCache.record(
      notification.notificationId,
      notification.email,
      notification.historyId,
    );
    telemetry.increment("pushes_acknowledged");

    const disposition = result.disposition;
    if (disposition === "stale") {
      telemetry.increment("stale_notifications_ignored");
      structuredLog("info", {
        subsystem: "gmail_push",
        event: "gmail_push_stale",
        request_id: correlationId,
        notification_id: notification.notificationId,
        history_id: notification.historyId,
        disposition,
        duration_ms: Date.now() - started,
      });
    } else if (disposition === "coalesced") {
      telemetry.increment("notifications_coalesced");
      structuredLog("info", {
        subsystem: "gmail_push",
        event: "gmail_push_coalesced",
        request_id: correlationId,
        notification_id: notification.notificationId,
        history_id: notification.historyId,
        disposition,
        duration_ms: Date.now() - started,
      });
    } else if (disposition === "auth_expired") {
      structuredLog("warn", {
        subsystem: "gmail_push",
        event: "gmail_push_auth_expired",
        request_id: correlationId,
        notification_id: notification.notificationId,
        history_id: notification.historyId,
        disposition,
        duration_ms: Date.now() - started,
      });
    } else {
      telemetry.increment("jobs_created", result.accounts);
      structuredLog("info", {
        subsystem: "gmail_push",
        event: "gmail_push_enqueued",
        request_id: correlationId,
        notification_id: notification.notificationId,
        history_id: notification.historyId,
        disposition,
        duration_ms: Date.now() - started,
      });
    }

    return NextResponse.json({
      accepted: true,
      requestId: correlationId,
      disposition,
      accounts: result.accounts,
      coalesced: result.coalesced,
      stale: result.stale,
    });
  } catch (error) {
    gmailPushCircuitBreaker.recordFailure(error);
    telemetry.increment("persistence_failures");
    structuredLog("error", {
      subsystem: "gmail_push",
      event: "gmail_push_persistence_failed",
      request_id: correlationId,
      notification_id: notification.notificationId,
      history_id: notification.historyId,
      email: notification.email,
      error: error instanceof Error ? error.message : "Persistence failed",
      duration_ms: Date.now() - started,
    });
    // Return retryable HTTP 503 so Pub/Sub retains redelivery responsibility
    return NextResponse.json(
      {
        accepted: false,
        error: "Persistence unavailable; Pub/Sub retry required",
        requestId: correlationId,
      },
      {
        status: 503,
        headers: { "Retry-After": "10" },
      },
    );
  }
}
