import {
  canModifyGmail,
  type AutomationSettings,
} from "@/lib/automationSettings";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

// Runs only inside the existing per-account Gmail lease. Classification retry
// and label retry are independent: a temporary Gmail failure cannot recreate
// tasks/drafts, nor can a successful label write hide an unprocessed message.
export async function flushProcessedGmailLabels(
  userId: string,
  accountId: string,
  accessToken: string,
  scope: string | null | undefined,
  settings: AutomationSettings,
) {
  if (
    (!settings.mark_processed_read && !settings.archive_junk) ||
    settings.mode === "manual"
  )
    return;
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("A Supabase server key is not configured");
  const { data, error } = await db
    .from("email_messages")
    .select(
      "id,google_message_id,label_ids,marked_read_at,archived_at,disposition,disposition_confidence,protected_sender,processed_at",
    )
    .eq("user_id", userId)
    .eq("google_account_id", accountId)
    .eq("processing_status", "processed")
    .or(
      [
        ...(settings.mark_processed_read ? ["marked_read_at.is.null"] : []),
        ...(settings.archive_junk
          ? [
              "and(archived_at.is.null,disposition.eq.MARKETING,protected_sender.eq.false)",
            ]
          : []),
      ].join(","),
    )
    .order("processed_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  for (const message of data ?? []) {
    if (!message.processed_at) continue;
    const read = settings.mark_processed_read && !message.marked_read_at;
    const archive =
      settings.archive_junk &&
      !message.archived_at &&
      !message.protected_sender &&
      message.disposition === "MARKETING" &&
      Number(message.disposition_confidence) >= 0.99;
    if (!read && !archive) continue;
    const sourceId = `${accountId}:${message.google_message_id}`;
    const actions = [
      ...(read ? ["email.mark_read"] : []),
      ...(archive ? ["email.archive"] : []),
    ];
    const reason = archive
      ? "Successfully processed, high-confidence retail promotion; archive is recoverable in Gmail All Mail."
      : "Email classification and downstream actions were persisted successfully.";
    const audit = async (
      status: string,
      errorMessage: string | null = null,
    ) => {
      const { error: auditError } = await db.from("automation_audit").upsert(
        actions.map((action) => ({
          user_id: userId,
          source_id: sourceId,
          action,
          status,
          reason,
          confidence: archive ? 0.99 : 1,
          reversible: true,
          error_message: errorMessage,
          completed_at:
            status === "completed" ? new Date().toISOString() : null,
        })),
        { onConflict: "user_id,source_id,action" },
      );
      if (auditError) throw auditError;
    };
    if (!canModifyGmail(scope)) {
      const missing =
        "Reconnect this Google account and allow Gmail modify access to mark processed mail read or archive junk. Existing read-only access is insufficient.";
      await audit("blocked", missing);
      const { error: blockedError } = await db
        .from("email_messages")
        .update({ label_sync_error: missing })
        .eq("user_id", userId)
        .eq("id", message.id);
      if (blockedError) throw blockedError;
      continue;
    }
    await audit("pending");
    try {
      const removeLabelIds = [
        ...(read ? ["UNREAD"] : []),
        ...(archive ? ["INBOX"] : []),
      ];
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.google_message_id)}/modify`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ removeLabelIds }),
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        },
      );
      // Label removal is idempotent, so network-uncertain outcomes are safe to
      // retry. A missing source is not silently reported as marked read.
      if (!response.ok)
        throw new Error(`Gmail label update failed: HTTP ${response.status}`);
      const now = new Date().toISOString();
      const { error: storedError } = await db
        .from("email_messages")
        .update({
          ...(read ? { marked_read_at: now } : {}),
          ...(archive ? { archived_at: now } : {}),
          label_ids: (message.label_ids ?? []).filter(
            (label: string) => !removeLabelIds.includes(label),
          ),
          label_sync_error: null,
        })
        .eq("user_id", userId)
        .eq("id", message.id)
        .eq("processing_status", "processed");
      if (storedError) throw storedError;
      await audit("completed");
    } catch (failure) {
      const detail =
        failure instanceof Error
          ? failure.message
          : "Gmail label update failed";
      await audit("failed", detail);
      const { error: failureError } = await db
        .from("email_messages")
        .update({ label_sync_error: detail })
        .eq("user_id", userId)
        .eq("id", message.id);
      if (failureError) throw failureError;
      console.error(
        JSON.stringify({
          service: "gmail-label-automation",
          account: accountId.slice(0, 8),
          stage: "retry",
          error: detail,
        }),
      );
    }
  }
}
