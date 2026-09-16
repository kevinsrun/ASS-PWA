import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type Transaction,
} from "plaid";
import { decryptServerSecret, encryptServerSecret } from "@/lib/secretBox";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function plaidConfiguration() {
  const missing = ["PLAID_CLIENT_ID", "PLAID_SECRET", "DATA_ENCRYPTION_KEY"].filter(
    (name) => !process.env[name]?.trim()
  );
  return { ready: missing.length === 0, missing, environment: process.env.PLAID_ENV ?? "sandbox" };
}

export function getPlaidClient() {
  const environment = process.env.PLAID_ENV?.trim() || "sandbox";
  if (!["sandbox", "development", "production"].includes(environment)) throw new Error("PLAID_ENV must be sandbox, development, or production");
  const basePath = environment === "production"
    ? PlaidEnvironments.production
    : environment === "development"
      ? PlaidEnvironments.development
      : PlaidEnvironments.sandbox;
  return new PlaidApi(new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": required("PLAID_CLIENT_ID"),
        "PLAID-SECRET": required("PLAID_SECRET"),
      },
    },
  }));
}

export async function createPlaidLinkToken(userId: string) {
  const configuration = plaidConfiguration();
  if (!configuration.ready) throw new Error(`Finance setup is incomplete: ${configuration.missing.join(", ")}`);
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim();
  const response = await getPlaidClient().linkTokenCreate({
    client_name: "ASS",
    language: "en",
    country_codes: [CountryCode.Us],
    products: [Products.Transactions],
    user: { client_user_id: userId },
    webhook: process.env.PLAID_WEBHOOK_URL?.trim() || undefined,
    transactions: { days_requested: 180 },
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });
  return { linkToken: response.data.link_token, expiration: response.data.expiration };
}

export function plaidFailure(error: unknown) {
  const data = (error as { response?: { data?: { error_code?: string; error_message?: string; request_id?: string } } } | null)?.response?.data;
  return {
    code: data?.error_code ?? null,
    requestId: data?.request_id ?? null,
    message: data?.error_message ?? (error instanceof Error ? error.message : "Unable to start Plaid Link"),
  };
}

export async function exchangePlaidPublicToken(
  userId: string,
  publicToken: string,
  institution?: { institution_id?: string | null; name?: string | null }
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const response = await getPlaidClient().itemPublicTokenExchange({ public_token: publicToken });
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("plaid_items").upsert({
    user_id: userId,
    item_id: response.data.item_id,
    access_token_encrypted: encryptServerSecret(response.data.access_token),
    institution_id: institution?.institution_id ?? null,
    institution_name: institution?.name ?? null,
    status: "ready",
    error_code: null,
    error_message: null,
    updated_at: now,
  }, { onConflict: "item_id" }).select("id").single();
  if (error) throw error;
  const { error: accountError } = await supabase.from("connected_accounts").upsert({
    id: data.id,
    user_id: userId,
    provider: "plaid",
    provider_subject: response.data.item_id,
    display_name: institution?.name ?? "Financial institution",
    sync_status: "ready",
    last_sync_error: null,
    updated_at: now,
  }, { onConflict: "id" });
  if (accountError) throw accountError;
  await syncPlaidItem(userId, String(data.id));
  return { itemId: response.data.item_id };
}

function transactionRow(userId: string, transaction: Transaction) {
  return {
    id: transaction.transaction_id,
    user_id: userId,
    account_id: transaction.account_id,
    name: transaction.name,
    merchant_name: transaction.merchant_name ?? null,
    amount: transaction.amount,
    iso_currency_code: transaction.iso_currency_code ?? "USD",
    occurred_on: transaction.date,
    pending: transaction.pending,
    category: transaction.personal_finance_category?.primary ?? transaction.category?.[0] ?? null,
    category_path: transaction.category ?? [],
    removed_at: null,
    raw: {
      payment_channel: transaction.payment_channel,
      website: transaction.website,
      personal_finance_category: transaction.personal_finance_category,
    },
    updated_at: new Date().toISOString(),
  };
}

export async function syncPlaidItem(userId: string, plaidItemId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data: item, error: itemError } = await supabase
    .from("plaid_items")
    .select("id,item_id,access_token_encrypted,cursor")
    .eq("id", plaidItemId)
    .eq("user_id", userId)
    .single();
  if (itemError || !item) throw itemError ?? new Error("Plaid connection not found");
  const { data: run, error: runError } = await supabase.from("finance_sync_runs").insert({
    user_id: userId,
    plaid_item_id: item.id,
    status: "running",
  }).select("id").single();
  if (runError) throw runError;
  try {
    const accessToken = decryptServerSecret(String(item.access_token_encrypted));
    const client = getPlaidClient();
    const balances = await client.accountsBalanceGet({ access_token: accessToken });
    const accountRows = balances.data.accounts.map((account) => ({
      id: account.account_id,
      user_id: userId,
      plaid_item_id: item.id,
      name: account.name,
      official_name: account.official_name ?? null,
      mask: account.mask ?? null,
      type: account.type,
      subtype: account.subtype ?? null,
      current_balance: account.balances.current,
      available_balance: account.balances.available,
      currency_code: account.balances.iso_currency_code ?? "USD",
      updated_at: new Date().toISOString(),
    }));
    if (accountRows.length) {
      const { error } = await supabase.from("finance_accounts").upsert(accountRows, { onConflict: "id" });
      if (error) throw error;
    }

    let cursor = item.cursor ? String(item.cursor) : undefined;
    let hasMore = true;
    let added: Transaction[] = [];
    let modified: Transaction[] = [];
    let removed: Array<{ transaction_id: string }> = [];
    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: accessToken,
        cursor,
        count: 500,
      });
      added = added.concat(response.data.added);
      modified = modified.concat(response.data.modified);
      removed = removed.concat(response.data.removed);
      cursor = response.data.next_cursor;
      hasMore = response.data.has_more;
    }
    const rows = [...added, ...modified].map((transaction) => transactionRow(userId, transaction));
    if (rows.length) {
      const { error } = await supabase.from("finance_transactions").upsert(rows, { onConflict: "id" });
      if (error) throw error;
    }
    if (removed.length) {
      const { error } = await supabase.from("finance_transactions").update({
        removed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId).in("id", removed.map((entry) => entry.transaction_id));
      if (error) throw error;
    }
    const completedAt = new Date().toISOString();
    await Promise.all([
      supabase.from("plaid_items").update({ cursor, status: "synced", error_code: null, error_message: null, last_successful_sync_at: completedAt, updated_at: completedAt }).eq("id", item.id),
      supabase.from("connected_accounts").update({ sync_status: "synced", last_sync_error: null, last_successful_sync_at: completedAt, updated_at: completedAt }).eq("id", item.id).eq("user_id", userId),
      supabase.from("finance_sync_runs").update({ status: "ok", added: added.length, modified: modified.length, removed: removed.length, completed_at: completedAt }).eq("id", run.id),
    ]);
    return { added: added.length, modified: modified.length, removed: removed.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Plaid synchronization failure";
    const plaidError = error as { response?: { data?: { error_code?: string } } };
    const code = plaidError.response?.data?.error_code ?? null;
    const completedAt = new Date().toISOString();
    await Promise.all([
      supabase.from("plaid_items").update({ status: "error", error_code: code, error_message: message, updated_at: completedAt }).eq("id", item.id),
      supabase.from("connected_accounts").update({ sync_status: "error", last_sync_error: message, updated_at: completedAt }).eq("id", item.id).eq("user_id", userId),
      supabase.from("finance_sync_runs").update({ status: "error", error_message: message, completed_at: completedAt }).eq("id", run.id),
    ]);
    throw error;
  }
}

export async function syncPlaidForUser(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data, error } = await supabase.from("plaid_items").select("id").eq("user_id", userId);
  if (error) throw error;
  const results = [];
  for (const item of data ?? []) results.push(await syncPlaidItem(userId, String(item.id)));
  return results;
}
