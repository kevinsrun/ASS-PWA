"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";

type Status = {
  scheduler: string;
  nextExpectedRun: string | null;
  accounts: Array<Record<string, unknown>>;
  drive: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  draftsWaiting: number;
  decisionsWaiting: number;
  classifications: Array<Record<string, unknown>>;
  assistantRuns: Array<Record<string, unknown>>;
};

type Integrity = {
  extractionItems: Array<Record<string, unknown>>;
  canonicalEvents: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  sourceLinks: Array<Record<string, unknown>>;
  recurringEvents: Array<Record<string, unknown>>;
  reconciliationRuns: Array<Record<string, unknown>>;
};

function when(value: unknown) {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "Never";
}

export default function SyncDebugPage() {
  const { session } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [working, setWorking] = useState(false);
  async function runNow() {
    if (!session?.access_token) return;
    setWorking(true);
    try {
      const response = await fetch("/api/intelligence/run", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Background sync failed.");
      await load();
      if (body.status === "partial") setError("Sync completed with integration errors. See Recent runs.");
      if (body.skipped) setError("Another background run is active. Try again after it finishes.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sync failed."); }
    finally { setWorking(false); }
  }
  const load = useCallback(async () => {
    if (!session?.access_token) return;
    const response = await fetch("/api/intelligence/status", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Sync status is unavailable.");
    setStatus(body); setError("");
  }, [session?.access_token]);
  const loadIntegrity = useCallback(async () => {
    if (!session?.access_token) return;
    const response = await fetch("/api/debug/calendar-integrity", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Calendar integrity data is unavailable.");
    setIntegrity(body);
  }, [session?.access_token]);
  async function integrityAction(action: "reconcile" | "retry_item", itemId?: string) {
    if (!session?.access_token) return;
    setWorking(true);
    try {
      const response = await fetch("/api/debug/calendar-integrity", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, itemId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Calendar integrity action failed.");
      setIntegrity(body.snapshot); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Calendar integrity action failed."); }
    finally { setWorking(false); }
  }
  useEffect(() => { void Promise.all([load(), loadIntegrity()]).catch((reason) => setError(reason instanceof Error ? reason.message : "Sync status is unavailable.")); }, [load, loadIntegrity]);
  return (
    <main className="now-page">
      <header className="now-header"><div><p>Developer</p><h1>Intelligence sync</h1></div><button type="button" onClick={() => void load()} aria-label="Refresh sync status"><RefreshCw size={19} /></button></header>
      <Link href="/profile" className="quiet-empty"><ArrowLeft size={17} />Back to profile</Link>
      {error ? <section className="focus-surface"><span>Sync error</span><h2>{error}</h2></section> : null}
      {status ? <>
        <section className="now-section"><div className="now-section-title"><span>Automation</span><button type="button" disabled={working} onClick={() => void runNow()}>{working ? "Running…" : "Run now"}</button></div><div className="essential-tasks"><p>Scheduler: {status.scheduler}</p><p>Last trigger: {when(status.runs[0]?.started_at)}</p><p>Last successful run: {when(status.runs.find((run) => run.status === "completed")?.completed_at)}</p>{status.runs[0]?.completed_at ? <p>Last duration: {Math.max(0, Math.round((Date.parse(String(status.runs[0].completed_at)) - Date.parse(String(status.runs[0].started_at))) / 1000))} seconds</p> : null}<p>Next expected check: {when(status.nextExpectedRun)} (provider delays possible)</p><p>{status.draftsWaiting} drafts waiting · {status.decisionsWaiting} decisions waiting</p></div></section>
        <section className="now-section"><div className="now-section-title"><span>Accounts</span></div><div className="assistant-insights">{status.accounts.map((account) => { const drive = status.drive.find((item) => item.google_account_id === account.id); return <article key={String(account.id)}><div className="assistant-insight-copy"><small>{String(account.connected_email ?? "Google account")}</small><strong>Calendar: {String(account.last_sync_status ?? "unknown")} · Gmail: {String(account.email_sync_status ?? "unknown")}</strong><p>Calendar {when(account.last_successful_sync_at)} · Gmail {when(account.last_email_sync_at)} · Drive {when(drive?.last_successful_sync_at)}</p>{account.last_sync_error || account.email_sync_error || drive?.last_sync_error ? <span>{String(account.last_sync_error ?? account.email_sync_error ?? drive?.last_sync_error)}</span> : null}</div></article>; })}</div></section>
        <section className="now-section"><div className="now-section-title"><span>Recent runs</span></div><div className="assistant-insights">{status.runs.map((run) => <article key={String(run.id)}><div className="assistant-insight-copy"><small>{when(run.started_at)} · {String(run.trigger_kind)}</small><strong>{String(run.status)}{run.skip_reason ? ` — ${String(run.skip_reason).replaceAll("_", " ")}` : ""}</strong><p>{Number(run.accounts_scanned)} accounts · {Number(run.emails_scanned)} emails · {Number(run.calendar_events_scanned)} calendar · {Number(run.drive_files_scanned)} Drive · {Number(run.action_items_created)} actions · {Number(run.drafts_created)} drafts</p>{Array.isArray(run.errors) && run.errors.length ? <span>{run.errors.map(String).join(" · ")}</span> : null}</div></article>)}</div></section>
        <section className="now-section"><div className="now-section-title"><span>Recent classifications</span></div><div className="essential-tasks">{status.classifications.slice(0, 10).map((item) => <p key={String(item.id)}>{String(item.predicted_label).replaceAll("_", " ")} · {Math.round(Number(item.confidence) * 100)}% · {String(item.status)}</p>)}</div></section>
        <section className="now-section"><div className="now-section-title"><span>Assistant actions</span></div><div className="assistant-insights">{status.assistantRuns.map((run) => <article key={String(run.id)}><div className="assistant-insight-copy"><small>{when(run.created_at)} · {String(run.status)}</small><strong>{String(run.request_text)}</strong><p>{Array.isArray(run.parsed_actions) ? `${run.parsed_actions.length} parsed action${run.parsed_actions.length === 1 ? "" : "s"}` : "No parsed actions"}</p>{run.error_message ? <span>{String(run.error_message)}</span> : null}<details><summary>Execution details</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ validation: run.validation_results, conflicts: run.conflict_results, execution: run.execution_results, reply: run.final_reply }, null, 2)}</pre></details></div></article>)}</div></section>
        {integrity ? <section className="now-section"><div className="now-section-title"><span>Calendar integrity</span><div><button type="button" disabled={working} onClick={() => void integrityAction("reconcile")}>{working ? "Reconciling…" : "Reconcile missing conversions"}</button><button type="button" disabled={working} onClick={() => void integrityAction("reconcile")}>Rebuild recurring events</button><button type="button" onClick={() => window.location.reload()}>Refresh calendar cache</button></div></div><div className="essential-tasks"><p>{integrity.extractionItems.length} extracted items · {integrity.canonicalEvents.length} canonical events · {integrity.plans.length} visible plans</p><p>{integrity.recurringEvents.length} academic series · {integrity.sourceLinks.length} traceable links</p>{integrity.extractionItems.filter((item) => item.conversion_error).slice(0, 12).map((item) => <div key={String(item.id)}><strong>{String(item.title)}</strong><p>{String(item.conversion_error)}</p><button type="button" disabled={working} onClick={() => void integrityAction("retry_item", String(item.id))}>Re-run extraction conversion</button></div>)}</div><details><summary>Show raw event payload</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(integrity, null, 2)}</pre></details></section> : null}
      </> : <p className="quiet-empty">Loading sync records…</p>}
    </main>
  );
}
