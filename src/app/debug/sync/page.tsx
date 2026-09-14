"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";

type Status = {
  nextExpectedRun: string | null;
  accounts: Array<Record<string, unknown>>;
  drive: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  draftsWaiting: number;
  decisionsWaiting: number;
  classifications: Array<Record<string, unknown>>;
};

function when(value: unknown) {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "Never";
}

export default function SyncDebugPage() {
  const { session } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  async function load() {
    if (!session?.access_token) return;
    const response = await fetch("/api/intelligence/status", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Sync status is unavailable.");
    setStatus(body); setError("");
  }
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Sync status is unavailable.")); }, [session?.access_token]);
  return (
    <main className="now-page">
      <header className="now-header"><div><p>Developer</p><h1>Intelligence sync</h1></div><button type="button" onClick={() => void load()} aria-label="Refresh sync status"><RefreshCw size={19} /></button></header>
      <Link href="/profile" className="quiet-empty"><ArrowLeft size={17} />Back to profile</Link>
      {error ? <section className="focus-surface"><span>Sync error</span><h2>{error}</h2></section> : null}
      {status ? <>
        <section className="now-section"><div className="now-section-title"><span>Overview</span></div><div className="essential-tasks"><p>Next expected run: {when(status.nextExpectedRun)}</p><p>{status.draftsWaiting} drafts waiting · {status.decisionsWaiting} decisions waiting</p></div></section>
        <section className="now-section"><div className="now-section-title"><span>Accounts</span></div><div className="assistant-insights">{status.accounts.map((account) => { const drive = status.drive.find((item) => item.google_account_id === account.id); return <article key={String(account.id)}><div className="assistant-insight-copy"><small>{String(account.connected_email ?? "Google account")}</small><strong>Calendar: {String(account.last_sync_status ?? "unknown")} · Gmail: {String(account.email_sync_status ?? "unknown")}</strong><p>Calendar {when(account.last_successful_sync_at)} · Gmail {when(account.last_email_sync_at)} · Drive {when(drive?.last_successful_sync_at)}</p>{account.last_sync_error || account.email_sync_error || drive?.last_sync_error ? <span>{String(account.last_sync_error ?? account.email_sync_error ?? drive?.last_sync_error)}</span> : null}</div></article>; })}</div></section>
        <section className="now-section"><div className="now-section-title"><span>Recent runs</span></div><div className="assistant-insights">{status.runs.map((run) => <article key={String(run.id)}><div className="assistant-insight-copy"><small>{when(run.started_at)} · {String(run.trigger_kind)}</small><strong>{String(run.status)}{run.skip_reason ? ` — ${String(run.skip_reason).replaceAll("_", " ")}` : ""}</strong><p>{Number(run.accounts_scanned)} accounts · {Number(run.emails_scanned)} emails · {Number(run.calendar_events_scanned)} calendar · {Number(run.drive_files_scanned)} Drive · {Number(run.action_items_created)} actions · {Number(run.drafts_created)} drafts</p>{Array.isArray(run.errors) && run.errors.length ? <span>{run.errors.map(String).join(" · ")}</span> : null}</div></article>)}</div></section>
        <section className="now-section"><div className="now-section-title"><span>Recent classifications</span></div><div className="essential-tasks">{status.classifications.slice(0, 10).map((item) => <p key={String(item.id)}>{String(item.predicted_label).replaceAll("_", " ")} · {Math.round(Number(item.confidence) * 100)}% · {String(item.status)}</p>)}</div></section>
      </> : <p className="quiet-empty">Loading sync records…</p>}
    </main>
  );
}
