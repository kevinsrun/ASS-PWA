"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
type Account = {
  id: string;
  email: string;
  enabled: boolean;
  permissionGranted: boolean;
  health?: {
    state: string;
    checkedAt: string;
    lastSuccessfulApiAt?: string;
    error?: string | null;
  };
};
export default function GoogleTasksSettings() {
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const token = session?.access_token;
  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch("/api/integrations/tasks", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setAccounts(body.accounts);
  }, [token]);
  useEffect(() => {
    void load().catch((error) => setMessage(error.message));
  }, [load]);
  async function act(accountId: string, action: "enable" | "disable" | "sync") {
    if (!token) return;
    setBusy(accountId);
    try {
      const response = await fetch("/api/integrations/tasks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accountId, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setMessage(
        result.busy
          ? "Account sync is already running; retry shortly."
          : result.errors?.length
            ? `${result.synced} tasks synced; ${result.errors.length} need attention: ${result.errors[0].message}`
            : action === "disable"
              ? "Google Tasks sync disabled. Existing Google tasks are kept."
              : `${result.synced} tasks synced to Google Tasks.`,
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Tasks action failed",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="settings-section">
      <h2>Google Tasks</h2>
      <div className="settings-group">
        {accounts.map((account) => (
          <div className="settings-row" key={account.id}>
            <div>
              <strong>{account.email}</strong>
              <span>
                {!account.enabled
                  ? "Not enabled"
                  : !account.permissionGranted
                    ? "Authorization required"
                    : account.health?.state === "connected" &&
                        Date.now() - Date.parse(account.health.checkedAt) <
                          5 * 60_000
                      ? "Verified"
                      : "Enabled · use Sync to verify API access"}
              </span>
              <span>
                Last successful API call:{" "}
                {account.health?.lastSuccessfulApiAt
                  ? new Date(
                      account.health.lastSuccessfulApiAt,
                    ).toLocaleString()
                  : "Never"}
              </span>
              {account.health?.error ? (
                <span role="status">{account.health.error}</span>
              ) : null}
            </div>
            <div>
              {account.enabled ? (
                <>
                  <button
                    disabled={busy === account.id || !account.permissionGranted}
                    onClick={() => void act(account.id, "sync")}
                  >
                    Sync Tasks
                  </button>
                  <button
                    disabled={busy === account.id}
                    onClick={() => void act(account.id, "disable")}
                  >
                    Disable
                  </button>
                  {!account.permissionGranted ? (
                    <button
                      disabled={busy === account.id}
                      onClick={() => void act(account.id, "enable")}
                    >
                      Authorize Tasks
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  disabled={busy === account.id}
                  onClick={() => void act(account.id, "enable")}
                >
                  Enable Google Tasks
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="settings-row">
          <span>
            Optional. Tasks sync to one selected account, not as blocking
            calendar events. Google Tasks supports due dates, not exact deadline
            times.
          </span>
        </div>
        {message ? (
          <div className="settings-row" role="status">
            {message}
          </div>
        ) : null}
      </div>
    </section>
  );
}
