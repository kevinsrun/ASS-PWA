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
    console.error(
      JSON.stringify({
        service: "gmail-push",
        stage: "payload-rejected",
        message:
          error instanceof Error ? error.message : "Invalid Gmail notification",
      }),
    );
    return NextResponse.json(
      { error: "Invalid Gmail notification" },
      { status: 400 },
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

  // Fail-Safe: Circuit breaker trips after repeated persistence failures
  if (gmailPushCircuitBreaker.isOpen()) {
    gmailPushCircuitBreaker.deferPush(
      notification.email,
      notification.historyId,
      notification.notificationId,
    );
    telemetry.increment("circuit_breaker_activations");
    telemetry.increment("pushes_acknowledged");
    structuredLog("warn", {
      subsystem: "gmail_push",
      event: "gmail_push_circuit_open",
      request_id: correlationId,
      notification_id: notification.notificationId,
      history_id: notification.historyId,
      email: notification.email,
      duration_ms: Date.now() - started,
    });
    // Return HTTP 202 to acknowledge to Pub/Sub and prevent redelivery storms
    return NextResponse.json(
      {
        accepted: false,
        deferred: true,
        circuit: "open",
        reason:
          "Persistence circuit breaker open; notification deferred to background sync",
        requestId: correlationId,
      },
      { status: 202 },
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

    const accounts = result.accounts;
    const isCoalesced = result.coalesced;
    const isStale = result.stale;

    if (isStale) {
      telemetry.increment("stale_notifications_ignored");
      structuredLog("info", {
        subsystem: "gmail_push",
        event: "gmail_push_stale",
        request_id: correlationId,
        notification_id: notification.notificationId,
        history_id: notification.historyId,
        accounts,
        duration_ms: Date.now() - started,
      });
    } else if (isCoalesced) {
      telemetry.increment("notifications_coalesced");
      structuredLog("info", {
        subsystem: "gmail_push",
        event: "gmail_push_coalesced",
        request_id: correlationId,
        notification_id: notification.notificationId,
        history_id: notification.historyId,
        accounts,
        duration_ms: Date.now() - started,
      });
    } else {
      telemetry.increment("jobs_created", accounts);
      structuredLog("info", {
        subsystem: "gmail_push",
        event: "gmail_push_enqueued",
        request_id: correlationId,
        notification_id: notification.notificationId,
        history_id: notification.historyId,
        accounts,
        duration_ms: Date.now() - started,
      });
    }

    return NextResponse.json({
      accepted: true,
      requestId: correlationId,
      accounts,
      coalesced: isCoalesced,
      stale: isStale,
    });
  } catch (error) {
    gmailPushCircuitBreaker.recordFailure(error);
    gmailPushCircuitBreaker.deferPush(
      notification.email,
      notification.historyId,
      notification.notificationId,
    );
    telemetry.increment("persistence_failures");
    telemetry.increment("pushes_acknowledged");
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
    // CRITICAL: Return HTTP 202 so Google Pub/Sub does not enter an infinite retry amplification loop
    return NextResponse.json(
      {
        accepted: false,
        deferred: true,
        error: "Persistence failed; notification deferred to background sync",
        requestId: correlationId,
      },
      { status: 202 },
    );
  }
}
