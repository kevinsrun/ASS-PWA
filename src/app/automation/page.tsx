"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import type { AutomationSettings } from "@/lib/automationSettings";
type Data = {
  suppressed: Array<{
    id: string;
    title: string;
    sender: string;
    summary: string;
    received_at: string | null;
    disposition: string;
  }>;
  settings: AutomationSettings;
  accounts: Array<{ id: string; email: string; canModifyGmail: boolean }>;
  audit: Array<{
    id: string;
    action: string;
    status: string;
    reason: string;
    error_message: string | null;
    created_at: string;
  }>;
};
const toggles = [
  [
    "mark_processed_read",
    "Mark processed email read",
    "Only after extracted actions are saved successfully.",
  ],
  [
    "archive_junk",
    "Archive obvious marketing",
    "Protected correspondence stays in your inbox. Archived mail remains in Gmail All Mail.",
  ],
  [
    "unsubscribe_junk",
    "Unsubscribe from obvious junk",
    "Aggressive mode only: requires repeated explicit ignores and a verified one-click endpoint. Protected correspondence is excluded.",
  ],
  [
    "create_deadlines",
    "Create verified deadlines",
    "Requires a high-confidence, explicit deadline.",
  ],
  [
    "create_reply_drafts",
    "Prepare reply drafts",
    "Draft only. Nothing is automatically sent.",
  ],
] as const;
export default function AutomationPage() {
  const { session } = useAuth();
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!session?.access_token) return;
    const response = await fetch("/api/automation", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setData(body);
  }, [session?.access_token]);
  useEffect(() => {
    void load().catch((failure) => setError(String(failure.message)));
  }, [load]);
  async function save(patch: Partial<AutomationSettings>) {
    if (!session?.access_token) return;
    if (
      patch.unsubscribe_junk &&
      !window.confirm(
        "Allow ASS to unsubscribe from obvious retail marketing in aggressive mode after repeated explicit ignores? Unsubscribe may not be reversible. Academic, financial, recruiting, research and security mail are protected.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/automation", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to save permissions",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="settings-page">
      <header className="settings-header">
        <Link href="/profile">Profile</Link>
        <h1>Automation</h1>
        <p>Quiet assistance. Clear boundaries.</p>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!session ? (
        <p>Sign in to manage your permissions.</p>
      ) : !data ? (
        <p role="status">Loading permissions…</p>
      ) : (
        <>
          <section className="settings-section">
            <h2>Email filtering</h2>
            <div className="settings-group">
              <label className="settings-row">
                <div>
                  <strong>Filtering mode</strong>
                  <span>
                    Suppressed mail remains recoverable. Critical correspondence
                    is protected.
                  </span>
                </div>
                <select
                  aria-label="Email filtering mode"
                  disabled={busy}
                  value={data.settings.mode}
                  onChange={(event) =>
                    void save({
                      mode: event.target.value as AutomationSettings["mode"],
                    })
                  }
                >
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive</option>
                  <option value="manual">Manual</option>
                </select>
              </label>
              {toggles.map(([key, title, description]) => (
                <label key={key} className="settings-row">
                  <div>
                    <strong>{title}</strong>
                    <span>{description}</span>
                  </div>
                  <input
                    type="checkbox"
                    aria-label={title}
                    disabled={busy}
                    checked={data.settings[key]}
                    onChange={(event) =>
                      void save({ [key]: event.target.checked })
                    }
                  />
                </label>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h2>Google permissions</h2>
            <div className="settings-group">
              {data.accounts.map((account) => (
                <div className="settings-row" key={account.id}>
                  <div>
                    <strong>{account.email}</strong>
                    <span>
                      {account.canModifyGmail
                        ? "Gmail label updates authorized"
                        : "Reconnect in Profile and grant Gmail modify permission to mark read or archive."}
                    </span>
                  </div>
                </div>
              ))}
              {!data.accounts.length ? (
                <div className="settings-row">
                  Connect a Google account in Profile.
                </div>
              ) : null}
            </div>
          </section>
          <section className="settings-section">
            <h2>Always requires your review</h2>
            <div className="settings-group">
              <div className="settings-row">
                <span>
                  Sending email, submitting forms, and deleting external
                  calendar events are not automatically authorized.
                </span>
              </div>
            </div>
          </section>
          <section className="settings-section">
            <h2>Recent actions</h2>
            <div className="settings-group">
              {data.audit.map((entry) => (
                <div key={entry.id} className="settings-row">
                  <div>
                    <strong>
                      {entry.action.replace("email.", "").replaceAll("_", " ")}{" "}
                      · {entry.status}
                    </strong>
                    <span>{entry.reason}</span>
                    {entry.error_message ? (
                      <span>{entry.error_message}</span>
                    ) : null}
                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {!data.audit.length ? (
                <div className="settings-row">
                  <span>No automated mailbox actions yet.</span>
                </div>
              ) : null}
            </div>
          </section>
          <section className="settings-section">
            <details>
              <summary>
                Everything else · {data.suppressed.length} filtered messages
              </summary>
              <p>Nothing was deleted. Original messages remain in Gmail.</p>
              <div className="settings-group">
                {data.suppressed.map((message) => (
                  <div key={message.id} className="settings-row">
                    <div>
                      <strong>{message.title}</strong>
                      <span>
                        {message.sender} · {message.disposition}
                      </span>
                      <span>{message.summary}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </section>
        </>
      )}
    </main>
  );
}
