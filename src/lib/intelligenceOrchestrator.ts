import { randomUUID } from "crypto";
import { createAssistantAction } from "@/lib/objectCreation";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";
import { syncGoogleCalendarForUser } from "@/lib/googleCalendarSync";
import { syncGoogleDriveForUser } from "@/lib/googleDriveSync";
import { plaidConfiguration, syncPlaidForUser } from "@/lib/plaid";
import { refreshFinanceAlerts } from "@/lib/finance";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { weatherDecisionContext } from "@/lib/weatherContext";
import { reconcileExtractedItems } from "@/lib/extractionReconciliation";

export type IntelligenceRunMetrics = {
  accountsScanned: number; emailsScanned: number; calendarEventsScanned: number;
  driveFilesScanned: number; actionItemsCreated: number; draftsCreated: number;
  calendarEventsCreated: number; financeItems: number; errors: string[];
};

async function queueFileFollowups(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data, error } = await supabase.from("extraction_items").select("id,title,description,normalized_type,confidence,due_at").eq("user_id", userId).eq("review_status", "pending").order("created_at", { ascending: false }).limit(25);
  if (error) throw error;
  let created = 0;
  for (const item of data ?? []) {
    const action = await createAssistantAction(userId, {
      sourceKind: "extraction_item", sourceId: String(item.id), actionType: "review_extraction",
      title: String(item.title), summary: String(item.description ?? "Review this detected file item."),
      priority: Number(item.confidence) >= 0.9 ? "high" : "normal",
      payload: { normalizedType: item.normalized_type, confidence: item.confidence, dueAt: item.due_at },
    });
    if (action.created) created += 1;
  }
  return created;
}

export async function runIntelligenceSync(triggerKind: "cron" | "manual" = "cron", options: { userId?: string; triggerSource?: string } = {}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const runId = randomUUID();
  const slot = triggerKind === "cron" ? new Date().toISOString().slice(0, 13) : null;
  const { data: acquired, error: lockError } = await supabase.rpc("acquire_intelligence_lock", { p_run_id: runId, p_slot: slot });
  if (lockError) throw lockError;
  if (!acquired) return { runId, status: "skipped" as const, skipped: true, reason: "already_running_or_processed" };
  let retryable = true;
  const metrics: IntelligenceRunMetrics = { accountsScanned: 0, emailsScanned: 0, calendarEventsScanned: 0, driveFilesScanned: 0, actionItemsCreated: 0, draftsCreated: 0, calendarEventsCreated: 0, financeItems: 0, errors: [] };
  try {
    const { error: runError } = await supabase.from("intelligence_sync_runs").insert({ id: runId, status: "running", trigger_kind: triggerKind, details: { triggerSource: options.triggerSource ?? triggerKind, slot } });
    if (runError) throw runError;
    console.info(JSON.stringify({ service: "intelligence-sync", runId, stage: "sync-started", triggerKind }));
    let audience = supabase.from("google_tokens").select("id,user_id,calendar_time_zone").order("user_id");
    if (options.userId) audience = audience.eq("user_id", options.userId);
    const { data: connections, error } = await audience;
    if (error) throw error;
    metrics.accountsScanned = connections?.length ?? 0;
    const userIds = new Set<string>();
    for (const connection of connections ?? []) userIds.add(String(connection.user_id));
    const { error: audienceError } = await supabase.from("intelligence_sync_runs").update({ user_ids: [...userIds] }).eq("id", runId);
    if (audienceError) throw audienceError;
    for (const connection of connections ?? []) {
      const userId = String(connection.user_id);
      const accountId = String(connection.id);
      try {
        const calendar = await syncGoogleCalendarForUser(userId, String(connection.calendar_time_zone ?? "America/New_York"), accountId);
        metrics.calendarEventsScanned += calendar.eventsImported ?? 0;
        if (calendar.state !== "synced") metrics.errors.push(`${accountId.slice(0, 8)} calendar: ${calendar.error ?? calendar.state}`);
      } catch (error) { metrics.errors.push(`${accountId.slice(0, 8)} calendar: ${error instanceof Error ? error.message : "unknown error"}`); }
      try {
        const gmail = await scanRecentGmailSuggestions(userId, accountId);
        metrics.emailsScanned += gmail.emailsScanned;
        metrics.actionItemsCreated += gmail.actionItemsCreated;
        metrics.draftsCreated += gmail.draftsCreated;
        metrics.calendarEventsCreated += gmail.calendarEventsCreated;
        metrics.errors.push(...gmail.failures.map((message) => `gmail ${message}`));
        for (const suggestion of gmail.suggestions) {
          try {
            const recommendation = await weatherDecisionContext(userId, { title: suggestion.title, date: suggestion.date, time: suggestion.time });
            if (recommendation) {
              const action = await createAssistantAction(userId, { sourceKind: "weather", sourceId: suggestion.id, actionType: "weather_adjustment", title: suggestion.title, summary: recommendation, priority: "high", payload: { emailSuggestionId: suggestion.id } });
              if (action.created) metrics.actionItemsCreated += 1;
            }
          } catch (error) { metrics.errors.push(`${accountId.slice(0, 8)} weather: ${error instanceof Error ? error.message : "unknown error"}`); }
        }
      } catch (error) { metrics.errors.push(`${accountId.slice(0, 8)} gmail: ${error instanceof Error ? error.message : "unknown error"}`); }
      try {
        const drive = await syncGoogleDriveForUser(userId, accountId);
        metrics.driveFilesScanned += drive.filesScanned;
        metrics.actionItemsCreated += drive.actionItemsCreated;
        metrics.errors.push(...drive.failures.map((message) => `drive ${message}`));
      } catch (error) { metrics.errors.push(`${accountId.slice(0, 8)} drive: ${error instanceof Error ? error.message : "unknown error"}`); }
    }
    for (const userId of userIds) {
      try {
        const { data: lastReconciliation, error: reconciliationReadError } = await supabase.from("extraction_reconciliation_runs").select("completed_at").eq("user_id", userId).in("status", ["completed", "partial"]).order("completed_at", { ascending: false }).limit(1).maybeSingle();
        if (reconciliationReadError) throw reconciliationReadError;
        if (!lastReconciliation?.completed_at || Date.now() - Date.parse(lastReconciliation.completed_at) >= 6 * 60 * 60 * 1000) {
          const reconciliation = await reconcileExtractedItems(userId, "cron");
          metrics.calendarEventsCreated += reconciliation.created + reconciliation.repaired;
          metrics.errors.push(...reconciliation.errors.map((item) => `reconcile ${item.title}: ${item.message}`));
        }
      } catch (error) { metrics.errors.push(`${userId.slice(0, 8)} reconcile: ${error instanceof Error ? error.message : "unknown error"}`); }
      try { metrics.actionItemsCreated += await queueFileFollowups(userId); }
      catch (error) { metrics.errors.push(`${userId.slice(0, 8)} files: ${error instanceof Error ? error.message : "unknown error"}`); }
      if (plaidConfiguration().ready) {
        try {
          const { data: items, error: financeReadError } = await supabase.from("plaid_items").select("last_successful_sync_at").eq("user_id", userId);
          if (financeReadError) throw financeReadError;
          if ((items ?? []).some((item) => !item.last_successful_sync_at || Date.now() - Date.parse(item.last_successful_sync_at) >= 4 * 60 * 60 * 1000)) {
            metrics.financeItems += (await syncPlaidForUser(userId)).length; await refreshFinanceAlerts(userId);
          }
        }
        catch (error) { metrics.errors.push(`${userId.slice(0, 8)} finance: ${error instanceof Error ? error.message : "unknown error"}`); }
      }
      const userAccounts = (connections ?? []).filter((connection) => String(connection.user_id) === userId).map((connection) => String(connection.id).slice(0, 8));
      for (const message of metrics.errors.filter((message) => userAccounts.some((id) => message.includes(id)))) {
        try {
          await createAssistantAction(userId, { sourceKind: "integration", sourceId: message.replace(/HTTP \d+.*/s, "").slice(0, 100), actionType: "connection_attention", title: "A connected account needs attention", summary: message, priority: "high", payload: { recommendedAction: /permission|scope|refresh|revoked|expired/i.test(message) ? "Reconnect the affected account in Profile" : "Review Automation integration errors" } });
        } catch (error) { console.error(JSON.stringify({ service: "intelligence-sync", runId, stage: "connection-alert-failed", message: error instanceof Error ? error.message : "Unknown error" })); }
      }
    }
    const status = metrics.errors.length ? "partial" : "completed";
    const completedAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("intelligence_sync_runs").update({
      status, accounts_scanned: metrics.accountsScanned, emails_scanned: metrics.emailsScanned,
      calendar_events_scanned: metrics.calendarEventsScanned, drive_files_scanned: metrics.driveFilesScanned,
      action_items_created: metrics.actionItemsCreated, drafts_created: metrics.draftsCreated,
      calendar_events_created: metrics.calendarEventsCreated, details: { financeItems: metrics.financeItems, triggerSource: options.triggerSource ?? triggerKind, slot },
      errors: metrics.errors, completed_at: completedAt,
    }).eq("id", runId);
    if (updateError) throw updateError;
    retryable = false;
    console.info(JSON.stringify({ service: "intelligence-sync", runId, stage: "sync-completed", status, ...metrics }));
    return { runId, status, ...metrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown intelligence sync failure";
    await supabase.from("intelligence_sync_runs").update({ status: "failed", errors: [...metrics.errors, message], completed_at: new Date().toISOString() }).eq("id", runId);
    console.error(JSON.stringify({ service: "intelligence-sync", runId, stage: "sync-failed", message }));
    throw error;
  } finally {
    const { error: releaseError } = await supabase.rpc("release_intelligence_lock", { p_run_id: runId, p_retryable: retryable });
    if (releaseError) console.error(JSON.stringify({ service: "intelligence-sync", runId, stage: "lock-release-failed", message: releaseError.message }));
  }
}
