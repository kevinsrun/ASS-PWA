"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { GoogleServiceHealth } from "@/lib/googleServiceHealth";
import {
  BarChart3,
  Activity,
  CalendarDays,
  ChevronRight,
  Cloud,
  Github,
  LogOut,
  UserRound,
  WalletCards,
} from "lucide-react";
import CalendarSyncIndicator from "@/components/CalendarSyncIndicator";
import { useCalendarSync } from "@/hooks/useCalendarSync";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";

export default function ProfilePage() {
  const { profile, syncStatus, updateProfile, reloadCloud } = useAppContext();
  const { configured, user, session, signOut } = useAuth();
  const [connections, setConnections] = useState<GoogleServiceHealth[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [busyAccount, setBusyAccount] = useState("");
  const [plaidConfigured, setPlaidConfigured] = useState<boolean | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const loadConnections = useCallback(async () => {
    if (!session?.access_token) return;
    const response = await fetch("/api/integrations/google", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Connection checks failed");
    setConnections(body.accounts); setPlaidConfigured(body.plaidConfigured); setConnectionError("");
  }, [session?.access_token]);
  useEffect(() => { void loadConnections().catch(error => setConnectionError(error instanceof Error ? error.message : "Connection checks failed")); }, [loadConnections]);
  async function connectionAction(accountId: string, action: "verify" | "disconnect") {
    if (!session?.access_token || (action === "disconnect" && !window.confirm("Disconnect this Google account? Background Gmail, Calendar and Drive access will stop. Imported ASS items are not deliberately deleted."))) return;
    setBusyAccount(accountId);
    try {
      const response = await fetch("/api/integrations/google", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ accountId, action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Connection action failed");
      await loadConnections(); await calendarSync.refresh();
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "Connection action failed"); }
    finally { setBusyAccount(""); }
  }
  async function logout() {
    setLoggingOut(true);
    try { await signOut(); }
    catch (error) { setConnectionError(error instanceof Error ? error.message : "Could not sign out"); setLoggingOut(false); }
  }
  const calendarSync = useCalendarSync(reloadCloud);
  const initials = (profile.displayName || user?.email || "A")
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <main className="settings-page">
      <header className="settings-header">
        <p>ASS</p>
        <h1>Settings</h1>
      </header>

      <section className="settings-identity" aria-label="Profile">
        <div className="settings-avatar" aria-hidden="true">{initials}</div>
        <div>
          <strong>{profile.displayName || "Your profile"}</strong>
          <span>{user?.email ?? "Local account"}</span>
        </div>
      </section>

      <section className="settings-section">
        <h2>ASS account</h2>
        <div className="settings-group"><div className="settings-row"><div><strong>Signed in as</strong><span>{user?.email ?? "Not signed in"}</span></div>{user ? <button type="button" disabled={loggingOut} onClick={() => void logout()}><LogOut size={18} aria-hidden="true" />{loggingOut ? "Signing out…" : "Log out"}</button> : <Link href="/login">Sign in</Link>}</div><div className="settings-row"><span>ASS login is separate from the Google service connections below.</span></div></div>
      </section>
      {connectionError ? <p role="alert" className="file-failure">{connectionError}</p> : null}
      <section className="settings-section">
        <h2>Personal</h2>
        <div className="settings-group">
          <label className="settings-field">
            <span><UserRound size={19} aria-hidden="true" />Name</span>
            <input
              value={profile.displayName}
              onChange={(event) => updateProfile({ displayName: event.target.value })}
              placeholder="Display name"
            />
          </label>
          <label className="settings-field">
            <span>Email</span>
            <input
              type="email"
              value={profile.primaryEmail}
              onChange={(event) => updateProfile({ primaryEmail: event.target.value })}
              placeholder={user?.email ?? "Primary email"}
            />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h2>Connected services</h2>
        <div className="settings-group">
          <div className="settings-row">
            <Cloud size={20} aria-hidden="true" />
            <div>
              <strong>ASS Cloud</strong>
              <span>
                {!configured
                  ? "Setup incomplete"
                  : user
                    ? syncStatus
                    : "Sign in to sync across devices"}
              </span>
            </div>
            <Link href="/login" aria-label={user ? "Change account" : "Sign in"}>
              {user ? "Account" : "Sign in"}<ChevronRight size={17} />
            </Link>
          </div>
          <div className="settings-row settings-row--calendar">
            <CalendarDays size={20} aria-hidden="true" />
            <CalendarSyncIndicator
              status={calendarSync.status}
              loading={calendarSync.loading}
              onSync={() => void calendarSync.syncNow()}
              onConnect={() => void calendarSync.connect()}
            />
          </div>
          {calendarSync.status.accounts.map((account) => (
            <div className="google-account-block" key={account.id}>
              <div className="settings-row google-account-row">
                <div
                  className="google-account-avatar"
                  style={account.color ? { background: account.color } : undefined}
                  aria-hidden="true"
                >
                  {(account.name || account.email).slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <strong>{account.name || account.email}</strong>
                  <span>{account.email} · {account.calendarCount} calendars</span>
                </div>
                <span className={`google-account-state is-${account.state}`}>
                  {account.state === "synced" ? "Synced" : account.state.replace("_", " ")}
                </span>
              </div>
              <div className="google-calendar-list" aria-label={`${account.email} calendars`}>
                {calendarSync.status.calendars.filter((calendar) => calendar.accountId === account.id).map((calendar) => (
                  <div key={`${account.id}:${calendar.id}`}>
                    <i style={calendar.color ? { background: calendar.color } : undefined} aria-hidden="true" />
                    <span>{calendar.name}</span>
                    <small className={`is-${calendar.state}`}>{calendar.state === "synced" ? "Synced" : calendar.state.replace("_", " ")}</small>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {connections.map(account => <div className="google-account-block" key={`health-${account.id}`}><div className="settings-row"><div><strong>{account.email}</strong><span>Verified service permissions—not ASS login</span></div><button type="button" disabled={busyAccount === account.id} onClick={() => void connectionAction(account.id, "verify")}>Check access</button></div>{(["gmail", "drive", "calendar"] as const).map(service => <div className="settings-row" key={service}><div><strong>{service === "gmail" ? "Gmail" : service === "drive" ? "Google Drive" : "Google Calendar"} · {account[service].state === "connected" ? "Connected" : account[service].state === "reconnect" ? "Reconnect required" : account[service].state === "unverified" ? "Not verified" : "Failed"}</strong><span>Last successful API call: {account[service].lastSuccessfulApiAt ? new Date(account[service].lastSuccessfulApiAt!).toLocaleString() : "Never"}</span><span>Last sync: {(service === "gmail" ? account.lastGmailSync : service === "drive" ? account.lastDriveSync : account.lastCalendarSync) ? new Date(String(service === "gmail" ? account.lastGmailSync : service === "drive" ? account.lastDriveSync : account.lastCalendarSync)).toLocaleString() : "Never"}</span>{account[service].error ? <span role="status">{account[service].error}</span> : null}</div></div>)}<div className="settings-row"><button type="button" onClick={() => void calendarSync.connect()}>Reconnect Google services</button><button type="button" disabled={busyAccount === account.id} onClick={() => void connectionAction(account.id, "disconnect")}>Disconnect account</button></div></div>)}
          {user && !connections.length && !connectionError ? <div className="settings-row"><span>No verified Google services yet. Connect an account or wait for the access check.</span></div> : null}
          {user ? (
            <button
              type="button"
              className="settings-row google-account-add"
              onClick={() => void calendarSync.connect()}
            >
              Add Google account
            </button>
          ) : null}
          <Link href="/finance" className="settings-row settings-row--link">
            <WalletCards size={20} aria-hidden="true" />
            <div><strong>Finance</strong><span>Plaid: {plaidConfigured === null ? "Checking configuration…" : plaidConfigured ? "Configured (bank access verified separately)" : "Not configured"}</span></div>
            <ChevronRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="settings-section">
        <h2>Developer</h2>
        <div className="settings-group">
          <div className="settings-row settings-row--fields">
            <Github size={20} aria-hidden="true" />
            <div>
              <strong>GitHub target</strong>
              <div className="settings-inline-fields">
                <input
                  value={profile.githubUsername}
                  onChange={(event) =>
                    updateProfile({ githubUsername: event.target.value })
                  }
                  placeholder="Username"
                  aria-label="GitHub username"
                />
                <input
                  value={profile.githubRepo}
                  onChange={(event) => updateProfile({ githubRepo: event.target.value })}
                  placeholder="owner/repository"
                  aria-label="GitHub repository"
                />
              </div>
            </div>
          </div>
          <Link href="/analytics" className="settings-row settings-row--link">
            <BarChart3 size={20} aria-hidden="true" />
            <div><strong>Analytics</strong><span>Review activity and trends</span></div>
            <ChevronRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/debug/sync" className="settings-row settings-row--link">
            <Activity size={20} aria-hidden="true" />
            <div><strong>Sync diagnostics</strong><span>Accounts, recent runs, and failures</span></div>
            <ChevronRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/debug/agent" className="settings-row settings-row--link"><Activity size={20} aria-hidden="true"/><div><strong>Agent Debug</strong><span>Tool calls, results, errors, and latency</span></div><ChevronRight size={17}/></Link>
        </div>
      </section>

    </main>
  );
}
