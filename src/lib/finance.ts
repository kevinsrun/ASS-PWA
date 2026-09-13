import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { getGeminiModel, rotateGeminiKey } from "@/lib/gemini";

type Assumptions = {
  expected_scholarships: number;
  expected_paychecks: number;
  expected_family_support: number;
  monthly_tuition: number;
  monthly_housing: number;
  monthly_food: number;
  monthly_transportation: number;
  monthly_books: number;
  emergency_reserve: number;
  savings_target: number;
};

const emptyAssumptions: Assumptions = {
  expected_scholarships: 0,
  expected_paychecks: 0,
  expected_family_support: 0,
  monthly_tuition: 0,
  monthly_housing: 0,
  monthly_food: 0,
  monthly_transportation: 0,
  monthly_books: 0,
  emergency_reserve: 0,
  savings_target: 0,
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function merchantKey(transaction: Record<string, unknown>) {
  return String(transaction.merchant_name ?? transaction.name ?? "Unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function getFinanceDashboard(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [accountsResult, transactionsResult, assumptionsResult, itemsResult] = await Promise.all([
    supabase.from("finance_accounts").select("id,name,official_name,mask,type,subtype,current_balance,available_balance,currency_code,updated_at").eq("user_id", userId).eq("hidden", false),
    supabase.from("finance_transactions").select("id,account_id,name,merchant_name,amount,occurred_on,pending,category,category_path").eq("user_id", userId).is("removed_at", null).gte("occurred_on", since).order("occurred_on", { ascending: false }).limit(1000),
    supabase.from("finance_assumptions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("plaid_items").select("id,institution_name,status,error_code,error_message,last_successful_sync_at").eq("user_id", userId),
  ]);
  const error = [accountsResult, transactionsResult, assumptionsResult, itemsResult].find((result) => result.error)?.error;
  if (error) throw error;
  const accounts = accountsResult.data ?? [];
  const transactions = transactionsResult.data ?? [];
  const assumptions = { ...emptyAssumptions, ...(assumptionsResult.data ?? {}) } as Assumptions;
  const cash = accounts.reduce((total, account) => {
    const balance = number(account.available_balance ?? account.current_balance);
    if (String(account.type) === "depository") return total + balance;
    if (String(account.type) === "credit") return total - number(account.current_balance);
    return total;
  }, 0);
  const observedMonthlySpend = transactions
    .filter((transaction) => number(transaction.amount) > 0 && !transaction.pending && String(transaction.category) !== "TRANSFER_IN")
    .reduce((total, transaction) => total + number(transaction.amount), 0) / 3;
  const fixedMonthly = assumptions.monthly_tuition + assumptions.monthly_housing + assumptions.monthly_food + assumptions.monthly_transportation + assumptions.monthly_books;
  const monthlyBurn = Math.max(observedMonthlySpend, fixedMonthly);
  const expectedInflows = assumptions.expected_scholarships + assumptions.expected_paychecks + assumptions.expected_family_support;
  const usableCash = Math.max(0, cash + expectedInflows - assumptions.emergency_reserve);
  const runwayDays = monthlyBurn > 0 ? Math.floor((usableCash / monthlyBurn) * 30) : null;
  const dangerDate = runwayDays === null ? null : new Date(Date.now() + runwayDays * 86_400_000).toISOString().slice(0, 10);
  const recommendedWeeklySpend = Math.max(0, (usableCash / 16) - (fixedMonthly * 12 / 52));
  const requiredWeeklyIncome = Math.max(0, (monthlyBurn - assumptions.expected_paychecks) * 12 / 52);

  const recurring = new Map<string, { name: string; count: number; total: number; income: boolean }>();
  for (const transaction of transactions) {
    if (transaction.pending) continue;
    const key = merchantKey(transaction);
    const entry = recurring.get(key) ?? { name: String(transaction.merchant_name ?? transaction.name), count: 0, total: 0, income: number(transaction.amount) < 0 };
    entry.count += 1;
    entry.total += Math.abs(number(transaction.amount));
    recurring.set(key, entry);
  }
  const recurringCashflow = [...recurring.values()]
    .filter((entry) => entry.count >= 2)
    .map((entry) => ({ ...entry, average: entry.total / entry.count }))
    .sort((a, b) => b.average - a.average)
    .slice(0, 8);
  const completedExpenses = transactions.filter((transaction) => number(transaction.amount) > 0 && !transaction.pending);
  const averageExpense = completedExpenses.length
    ? completedExpenses.reduce((total, transaction) => total + number(transaction.amount), 0) / completedExpenses.length
    : 0;
  const unusualExpenses = completedExpenses
    .filter((transaction) => averageExpense > 0 && number(transaction.amount) >= Math.max(100, averageExpense * 3))
    .slice(0, 5)
    .map((transaction) => ({ id: transaction.id, name: transaction.merchant_name ?? transaction.name, amount: number(transaction.amount), date: transaction.occurred_on }));

  return {
    configured: true,
    connected: (itemsResult.data ?? []).length > 0,
    institutions: itemsResult.data ?? [],
    accounts,
    assumptions,
    recentTransactions: transactions.slice(0, 12),
    recurringCashflow,
    unusualExpenses,
    runway: {
      cash,
      usableCash,
      monthlyBurn,
      runwayDays,
      dangerDate,
      recommendedWeeklySpend,
      requiredWeeklyIncome,
      savingsProgress: assumptions.savings_target > 0 ? Math.min(1, Math.max(0, cash / assumptions.savings_target)) : null,
    },
  };
}

export async function refreshFinanceAlerts(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) return;
  const dashboard = await getFinanceDashboard(userId);
  const alerts: Array<Record<string, unknown>> = [];
  if (dashboard.runway.runwayDays !== null && dashboard.runway.runwayDays < 90) {
    alerts.push({
      user_id: userId,
      dedupe_key: `finance-runway:${dashboard.runway.dangerDate}`,
      kind: "finance_runway",
      severity: dashboard.runway.runwayDays < 30 ? "high" : "medium",
      title: `${dashboard.runway.runwayDays} days of financial runway`,
      summary: dashboard.runway.dangerDate ? `At the current burn rate, available cash reaches the reserve around ${dashboard.runway.dangerDate}.` : "Runway needs attention.",
      recommendation: `Keep flexible spending near $${Math.round(dashboard.runway.recommendedWeeklySpend)} per week or add $${Math.round(dashboard.runway.requiredWeeklyIncome)} per week in income.`,
      status: "pending",
      updated_at: new Date().toISOString(),
    });
  }
  for (const expense of dashboard.unusualExpenses.slice(0, 2)) {
    alerts.push({
      user_id: userId,
      dedupe_key: `finance-unusual:${expense.id}`,
      kind: "finance_unusual",
      severity: "normal",
      title: `Review $${Math.round(expense.amount)} at ${expense.name}`,
      summary: "This expense is materially higher than your recent average.",
      recommendation: "Confirm it was expected and include it in your Brown runway if it will recur.",
      status: "pending",
      updated_at: new Date().toISOString(),
    });
  }
  if (alerts.length) {
    const { error } = await supabase.from("assistant_alerts").upsert(alerts, { onConflict: "user_id,dedupe_key" });
    if (error) throw error;
  }
  if (process.env.GEMINI_API_KEYS?.trim() && dashboard.connected) {
    const prompt = `You are the cautious financial planning assistant inside ASS. Analyze only these aggregates; do not provide investment advice, execute transactions, or claim certainty.

Cash: $${dashboard.runway.cash.toFixed(2)}
Usable cash after expected inflows and reserve: $${dashboard.runway.usableCash.toFixed(2)}
Estimated monthly burn: $${dashboard.runway.monthlyBurn.toFixed(2)}
Estimated runway days: ${dashboard.runway.runwayDays ?? "unknown"}
Suggested flexible weekly ceiling: $${dashboard.runway.recommendedWeeklySpend.toFixed(2)}
Estimated weekly income gap: $${dashboard.runway.requiredWeeklyIncome.toFixed(2)}
Largest recurring cash-flow estimates: ${JSON.stringify(dashboard.recurringCashflow.slice(0, 5))}
Unusual expenses: ${JSON.stringify(dashboard.unusualExpenses)}

Return strict JSON with keys title, summary, recommendation. Keep each value under 35 words. Make assumptions explicit and recommend reviewing source transactions.`;
    try {
      let result;
      try {
        result = await getGeminiModel().generateContent(prompt);
      } catch {
        rotateGeminiKey();
        result = await getGeminiModel().generateContent(prompt);
      }
      const raw = result.response.text().replace(/^```json\s*|\s*```$/g, "").trim();
      const brief = JSON.parse(raw) as { title?: string; summary?: string; recommendation?: string };
      const week = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from("assistant_alerts").upsert({
        user_id: userId,
        dedupe_key: `finance-brief:${week}`,
        kind: "finance_brief",
        severity: "normal",
        title: brief.title || "Weekly financial check-in",
        summary: brief.summary || "Review your current runway assumptions.",
        recommendation: brief.recommendation || "Confirm recent transactions and update expected inflows.",
        status: "pending",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,dedupe_key" });
      if (error) throw error;
    } catch (error) {
      console.error(JSON.stringify({ service: "finance-intelligence", stage: "brief_failed", message: error instanceof Error ? error.message : "Unknown failure" }));
    }
  }
}
