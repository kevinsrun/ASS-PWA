"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Building2, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { usePlaidLink } from "react-plaid-link";
import type { PlaidLinkOnSuccess } from "react-plaid-link";
import { useAuth } from "@/providers/AuthProvider";

type FinanceDashboard = {
  configured: boolean;
  connected: boolean;
  missing?: string[];
  institutions?: Array<{ id: string; institution_name: string | null; status: string; error_message: string | null; last_successful_sync_at: string | null }>;
  accounts?: Array<{ id: string; name: string; mask: string | null; type: string; current_balance: number | null; available_balance: number | null; currency_code: string }>;
  assumptions?: Record<string, number>;
  recentTransactions?: Array<{ id: string; name: string; merchant_name: string | null; amount: number; occurred_on: string; pending: boolean }>;
  recurringCashflow?: Array<{ name: string; average: number; income: boolean }>;
  unusualExpenses?: Array<{ id: string; name: string; amount: number; date: string }>;
  runway?: { cash: number; usableCash: number; monthlyBurn: number; runwayDays: number | null; dangerDate: string | null; recommendedWeeklySpend: number; requiredWeeklyIncome: number; savingsProgress: number | null };
};

const assumptionFields = [
  ["expected_scholarships", "Expected scholarships"],
  ["expected_paychecks", "Expected paychecks"],
  ["expected_family_support", "Expected family support"],
  ["monthly_tuition", "Monthly tuition"],
  ["monthly_housing", "Monthly housing"],
  ["monthly_food", "Monthly food"],
  ["monthly_transportation", "Monthly transportation"],
  ["monthly_books", "Monthly books"],
  ["emergency_reserve", "Emergency reserve"],
  ["savings_target", "Savings target"],
] as const;

function money(value = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function relativeTime(value: string | null) {
  if (!value) return "Never synced";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  return `Synced ${Math.round(minutes / 60)}h ago`;
}

export default function FinancePage() {
  const { session } = useAuth();
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("Sign in to use Finance");
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...init?.headers },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Finance request failed");
    return body;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      setDashboard(await api("/api/finance"));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Finance unavailable");
    }
  }, [api, session?.access_token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.search.includes("oauth_state_id")) return;
    setLinkToken(window.sessionStorage.getItem("ass:plaid-link-token"));
  }, []);

  const onSuccess: PlaidLinkOnSuccess = useCallback(async (publicToken, metadata) => {
    if (!publicToken) {
      setError("Plaid did not return a connection token");
      return;
    }
    setBusy(true);
    try {
      await api("/api/finance/exchange", { method: "POST", body: JSON.stringify({ publicToken, institution: metadata.institution }) });
      window.sessionStorage.removeItem("ass:plaid-link-token");
      setLinkToken(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to connect account");
    } finally {
      setBusy(false);
    }
  }, [api, load]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (exitError) => exitError && setError(exitError.display_message || "Plaid Link was closed"),
    receivedRedirectUri: typeof window !== "undefined" && window.location.search.includes("oauth_state_id") ? window.location.href : undefined,
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, open, ready]);

  async function connect() {
    setBusy(true);
    try {
      const body = await api("/api/finance/link-token", { method: "POST" });
      window.sessionStorage.setItem("ass:plaid-link-token", body.linkToken);
      setLinkToken(body.linkToken);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to start Plaid");
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      await api("/api/finance/sync", { method: "POST" });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to sync finances");
    } finally {
      setBusy(false);
    }
  }

  async function saveAssumptions(form: FormData) {
    const values = Object.fromEntries(assumptionFields.map(([key]) => [key, Number(form.get(key) || 0)]));
    setBusy(true);
    try {
      setDashboard(await api("/api/finance", { method: "PATCH", body: JSON.stringify(values) }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save planning values");
    } finally {
      setBusy(false);
    }
  }

  const primaryStatus = useMemo(() => dashboard?.institutions?.[0], [dashboard?.institutions]);
  const runway = dashboard?.runway;

  return (
    <main className="finance-page">
      <header className="finance-header">
        <Link href="/profile" aria-label="Back to settings"><ArrowLeft size={20} /></Link>
        <div><p>Private planning</p><h1>Finance</h1></div>
        {dashboard?.connected ? <button type="button" onClick={() => void sync()} disabled={busy} aria-label="Sync finances"><RefreshCw size={19} className={busy ? "is-spinning" : ""} /></button> : <span />}
      </header>

      {error ? <div className="finance-error"><AlertCircle size={18} /><span>{error}</span></div> : null}

      {!dashboard?.configured ? (
        <section className="finance-empty">
          <WalletCards size={28} />
          <h2>Plaid needs configuration</h2>
          <p>Add the server-only variables listed in <code>.env.example</code>, then restart ASS.</p>
          <small>Missing: {dashboard?.missing?.join(", ") || "Loading…"}</small>
        </section>
      ) : !dashboard.connected ? (
        <section className="finance-empty">
          <ShieldCheck size={30} />
          <h2>See how long your money lasts</h2>
          <p>Connect Chase or another institution through Plaid. ASS receives read-only account and transaction data—never your bank password.</p>
          <button type="button" onClick={() => void connect()} disabled={busy}>{busy ? "Opening…" : "Connect an account"}</button>
        </section>
      ) : (
        <>
          <section className="runway-hero">
            <span>Estimated runway</span>
            <h2>{runway?.runwayDays == null ? "Still learning" : `${runway.runwayDays} days`}</h2>
            <p>{runway?.dangerDate ? `Based on current data, your reserve threshold is reached around ${runway.dangerDate}.` : "Add planning assumptions for a more useful estimate."}</p>
          </section>

          <section className="finance-metrics" aria-label="Financial planning summary">
            <article><span>Usable cash</span><strong>{money(runway?.usableCash)}</strong></article>
            <article><span>Monthly burn</span><strong>{money(runway?.monthlyBurn)}</strong></article>
            <article><span>Weekly ceiling</span><strong>{money(runway?.recommendedWeeklySpend)}</strong></article>
            <article><span>Weekly income gap</span><strong>{money(runway?.requiredWeeklyIncome)}</strong></article>
          </section>

          <section className="finance-section">
            <div className="finance-section-title"><h2>Institutions</h2><span>{relativeTime(primaryStatus?.last_successful_sync_at ?? null)}</span></div>
            <div className="finance-list">
              {dashboard.institutions?.map((institution) => (
                <div key={institution.id}><Building2 size={19} /><div><strong>{institution.institution_name || "Connected institution"}</strong><span>{institution.error_message || institution.status}</span></div></div>
              ))}
            </div>
          </section>

          <section className="finance-section">
            <div className="finance-section-title"><h2>Accounts</h2><span>{money(runway?.cash)}</span></div>
            <div className="finance-list">
              {dashboard.accounts?.map((account) => (
                <div key={account.id}><WalletCards size={19} /><div><strong>{account.name} {account.mask ? `••${account.mask}` : ""}</strong><span>{account.type}</span></div><b>{money(account.available_balance ?? account.current_balance ?? 0)}</b></div>
              ))}
            </div>
          </section>

          <details className="finance-assumptions">
            <summary>Planning assumptions</summary>
            <form action={(form) => void saveAssumptions(form)}>
              {assumptionFields.map(([key, label]) => <label key={key}><span>{label}</span><input name={key} type="number" min="0" step="1" defaultValue={dashboard.assumptions?.[key] ?? 0} /></label>)}
              <button type="submit" disabled={busy}>Update estimate</button>
            </form>
          </details>

          <p className="finance-disclaimer">Planning estimates only. Review source transactions and consult a qualified professional for financial decisions. ASS cannot move money or provide investment advice.</p>
        </>
      )}
    </main>
  );
}
