import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, ApiAuthError } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import {
  gmailPushConfiguration,
  gmailPushCircuitBreaker,
  telemetry,
} from "@/lib/gmailPush";
import { ollamaConfiguration } from "@/lib/ai/ollama";
import { createAssistantAction } from "@/lib/objectCreation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const db = getServiceSupabaseClient();
    if (!db) throw Error();
    const since = new Date(Date.now() - 86400000).toISOString();

    const [queue, watches, pref, training, cooldown, accounts, drive] =
      await Promise.all([
        db
          .from("gmail_processing_queue")
          .select(
            "id,status,created_at,completed_at,last_provider_status,attempt_history",
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1000),
        db
          .from("gmail_watch_state")
          .select("last_successful_push,last_successful_sync,last_error")
          .eq("user_id", user.id),
        db
          .from("model_training_preferences")
          .select("enabled,retention_days")
          .eq("user_id", user.id)
          .maybeSingle(),
        db
          .from("model_training_examples")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        db
          .from("ai_provider_cooldowns")
          .select("cooldown_until,reason,last_429,last_503")
          .eq("provider", "gemini")
          .maybeSingle(),
        db
          .from("google_tokens")
          .select(
            "last_sync_status,last_successful_sync_at,email_sync_status,last_email_sync_at",
          )
          .eq("user_id", user.id)
          .is("disconnected_at", null),
        db
          .from("drive_sync_state")
          .select("sync_status,last_successful_sync_at")
          .eq("user_id", user.id),
      ]);

    const failed = [
      queue,
      watches,
      pref,
      training,
      cooldown,
      accounts,
      drive,
    ].find((item) => item.error)?.error;
    if (failed) throw failed;

    const jobs = queue.data ?? [];
    const waiting = jobs.filter((j) =>
      ["queued", "processing", "retry_wait"].includes(j.status),
    );
    const oldest = waiting
      .toSorted(
        (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
      )[0];
    const attempts = jobs.flatMap((j) =>
      Array.isArray(j.attempt_history) ? j.attempt_history : [],
    ) as Array<{ provider_status?: number }>;
    const activeCooldown =
      cooldown.data && Date.parse(cooldown.data.cooldown_until) > Date.now();
    const latest = (
      field: "completed_at" | "created_at",
      statuses: string[],
    ) =>
      jobs
        .filter((j) => statuses.includes(j.status) && j[field])
        .map((j) => j[field] as string)
        .toSorted()
        .at(-1) ?? null;

    const deadLetterCount = jobs.filter(
      (j) => j.status === "dead_letter",
    ).length;
    const authExpiredCount = (accounts.data ?? []).filter(
      (a) =>
        a.last_sync_status === "auth_expired" ||
        a.email_sync_status === "auth_expired",
    ).length;
    const cbState = gmailPushCircuitBreaker.getState();
    const cbOpen = gmailPushCircuitBreaker.isOpen();
    const isBacklogged = Boolean(
      oldest && Date.now() - Date.parse(oldest.created_at) > 900000,
    );

    const resourceStatus: "healthy" | "warning" | "critical" =
      cbOpen || deadLetterCount > 0
        ? "critical"
        : isBacklogged || authExpiredCount > 0 || waiting.length > 20
          ? "warning"
          : "healthy";

    const alarms = {
      status: resourceStatus,
      circuit_breaker_open: cbOpen,
      circuit_breaker_state: cbState.state,
      consecutive_failures: cbState.failures,
      dead_letter_count: deadLetterCount,
      auth_expired_count: authExpiredCount,
      queue_depth: waiting.length,
      is_backlogged: isBacklogged,
      oldest_job_age_seconds: oldest
        ? Math.floor((Date.now() - Date.parse(oldest.created_at)) / 1000)
        : null,
    };

    if (resourceStatus === "critical") {
      try {
        await createAssistantAction(user.id, {
          sourceKind: "integration",
          sourceId: "resource-exhaustion-alarm",
          actionType: "connection_attention",
          title: "Resource exhaustion alarm active",
          summary: `ASS detected ${cbOpen ? "circuit breaker trip" : "dead-letter items in queue"}. Review Developer Health.`,
          priority: "urgent",
          payload: alarms,
        });
      } catch {
        // Ignore notification creation errors
      }
    }

    return NextResponse.json(
      {
        gmail_push_status: gmailPushConfiguration().ready
          ? "configured"
          : "not_configured",
        alarms,
        circuit_breaker: cbState,
        telemetry: telemetry.getAll(),
        queue: {
          status: isBacklogged ? "backlogged" : "healthy",
          depth: waiting.length,
          oldest_job_age_seconds: alarms.oldest_job_age_seconds,
          last_completed_job: latest("completed_at", ["completed"]),
          last_failed_job: latest("completed_at", ["failed", "dead_letter"]),
          completed_24h: jobs.filter(
            (j) => j.status === "completed" && j.completed_at >= since,
          ).length,
          failed_24h: jobs.filter(
            (j) => j.status === "failed" && j.completed_at >= since,
          ).length,
          dead_letter_24h: jobs.filter(
            (j) => j.status === "dead_letter" && j.completed_at >= since,
          ).length,
          retry_rate: jobs.length ? attempts.length / jobs.length : 0,
          provider_429_count: attempts.filter((a) => a.provider_status === 429)
            .length,
          provider_503_count: attempts.filter((a) => a.provider_status === 503)
            .length,
        },
        classifier: {
          gemini: activeCooldown
            ? "rate_limited"
            : process.env.GEMINI_API_KEYS
              ? "configured"
              : "not_configured",
          cooldown_until: activeCooldown
            ? cooldown.data!.cooldown_until
            : null,
          ollama: ollamaConfiguration().enabled ? "configured" : "disabled",
        },
        training: {
          collection: pref.data?.enabled ? "on" : "off",
          rows: training.count ?? 0,
          retention_days: pref.data?.retention_days ?? 90,
        },
        calendar_sync_status: (accounts.data ?? []).map((a) => ({
          status: a.last_sync_status,
          last_success: a.last_successful_sync_at,
        })),
        gmail_processing_status: (accounts.data ?? []).map((a) => ({
          status: a.email_sync_status,
          last_success: a.last_email_sync_at,
        })),
        drive_sync_status: (drive.data ?? []).map((d) => ({
          status: d.sync_status,
          last_success: d.last_successful_sync_at,
        })),
        push_intake: (watches.data ?? []).map((w) => ({
          last_push: w.last_successful_push,
          last_completed: w.last_successful_sync,
          error: w.last_error,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ApiAuthError
            ? error.message
            : "Health unavailable",
      },
      {
        status: error instanceof ApiAuthError ? error.status : 500,
      },
    );
  }
}
