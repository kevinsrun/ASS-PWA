import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export type GoogleToken = {
  id?: string;
  access_token: string;
  expires_in?: number;
  expires_at?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export type GoogleAccountRecord = GoogleToken & {
  id: string;
  userId: string;
  googleSubject: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  accountColor: string | null;
  lastSuccessfulSyncAt: string | null;
  lastEmailSyncAt: string | null;
  gmailHistoryId: string | null;
  calendarTimeZone: string;
};

type OAuthState = { userId: string; expiresAt: number; nonce: string };

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
  "email",
  "profile",
];

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function encryptionKey() {
  return createHmac("sha256", requireEnv("GOOGLE_CLIENT_SECRET"))
    .update("ass-google-token-encryption-v1")
    .digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher
    .getAuthTag()
    .toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decrypt(value: string) {
  if (!value.startsWith("v1:")) return value;
  const [, iv, tag, encrypted] = value.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function signState(payload: string) {
  return createHmac("sha256", requireEnv("GOOGLE_CLIENT_SECRET"))
    .update(payload)
    .digest("base64url");
}

export function createGoogleOAuthState(userId: string) {
  const state: OAuthState = {
    userId,
    expiresAt: Date.now() + 10 * 60_000,
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${signState(payload)}`;
}

export function verifyGoogleOAuthState(value: string) {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    throw new Error("Google OAuth state is missing or invalid");
  }
  const expected = Buffer.from(signState(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Google OAuth state signature is invalid");
  }
  const state = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  ) as OAuthState;
  if (!state.userId || state.expiresAt < Date.now()) {
    throw new Error("Google OAuth state has expired");
  }
  return state;
}

export function getGoogleAuthUrl(userId: string) {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    scope: GOOGLE_SCOPES.join(" "),
    state: createGoogleOAuthState(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function requestGoogleToken(params: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const reason =
      typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`Google token request failed: ${reason}`);
  }
  const token = body as GoogleToken;
  return {
    ...token,
    expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
  };
}

async function fetchGoogleIdentity(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Unable to read the connected Google profile: HTTP ${response.status}`);
  }
  return (await response.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
}

async function syncConnectedAccount(
  userId: string,
  accountId: string,
  identity: Awaited<ReturnType<typeof fetchGoogleIdentity>>
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { error } = await supabase.from("connected_accounts").upsert({
    id: accountId,
    user_id: userId,
    provider: "google",
    provider_subject: identity.sub ?? null,
    email: identity.email ?? null,
    display_name: identity.name ?? null,
    avatar_url: identity.picture ?? null,
    sync_status: "ready",
    last_sync_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) throw new Error(`Unable to store the connected Google account: ${error.message}`);
  await supabase.from("google_tokens").update({ connected_account_id: accountId }).eq("id", accountId);
}

async function writeStoredToken(
  userId: string,
  token: GoogleToken,
  identity: Awaited<ReturnType<typeof fetchGoogleIdentity>>,
  existingAccountId?: string
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const base = {
    user_id: userId,
    google_subject: identity.sub ?? null,
    connected_email: identity.email ?? null,
    display_name: identity.name ?? null,
    avatar_url: identity.picture ?? null,
    access_token: encrypt(token.access_token),
    scope: token.scope ?? null,
    token_type: token.token_type ?? "Bearer",
    expires_at: token.expires_at ?? null,
    last_sync_status: "ready",
    last_sync_error: null,
    updated_at: new Date().toISOString(),
  };
  let accountId = existingAccountId;
  if (!accountId && identity.sub) {
    const { data } = await supabase
      .from("google_tokens")
      .select("id")
      .eq("user_id", userId)
      .eq("google_subject", identity.sub)
      .maybeSingle();
    accountId = data?.id ? String(data.id) : undefined;
  }
  // Older single-account rows predate OpenID profile fields. Match those by
  // email on the first reconnect so adding multi-account support never leaves
  // behind a duplicate legacy connection.
  if (!accountId && identity.email) {
    const { data } = await supabase
      .from("google_tokens")
      .select("id")
      .eq("user_id", userId)
      .ilike("connected_email", identity.email)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    accountId = data?.id ? String(data.id) : undefined;
  }
  if (accountId) {
    const update = {
      ...base,
      ...(token.refresh_token
        ? { refresh_token: encrypt(token.refresh_token) }
        : {}),
    };
    const { error } = await supabase
      .from("google_tokens")
      .update(update)
      .eq("id", accountId)
      .eq("user_id", userId);
    if (error) throw new Error(`Unable to update Google credentials: ${error.message}`);
    await syncConnectedAccount(userId, accountId, identity);
    return accountId;
  }
  const { data, error } = await supabase.from("google_tokens").insert({
    ...base,
    refresh_token: token.refresh_token ? encrypt(token.refresh_token) : null,
  }).select("id").single();
  if (error) {
    throw new Error(`Unable to store Google credentials: ${error.message}`);
  }
  const insertedId = String(data.id);
  await syncConnectedAccount(userId, insertedId, identity);
  return insertedId;
}

export async function exchangeGoogleCode(code: string, userId: string) {
  const token = await requestGoogleToken(
    new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    })
  );
  const identity = await fetchGoogleIdentity(token.access_token);
  const accountId = await writeStoredToken(userId, token, identity);
  return { token, accountId, identity };
}

export async function listGoogleAccounts(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data, error } = await supabase
    .from("google_tokens")
    .select("id,user_id,google_subject,connected_email,display_name,avatar_url,account_color,scope,last_sync_status,last_sync_error,last_successful_sync_at,last_email_sync_at,gmail_history_id,calendar_time_zone")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Unable to list Google accounts: ${error.message}`);
  return data ?? [];
}

export async function readStoredGoogleToken(userId: string, accountId?: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  let query = supabase
    .from("google_tokens")
    .select("id,user_id,google_subject,connected_email,display_name,avatar_url,account_color,access_token,refresh_token,scope,token_type,expires_at,last_successful_sync_at,last_email_sync_at,gmail_history_id,calendar_time_zone")
    .eq("user_id", userId);
  query = accountId ? query.eq("id", accountId) : query.order("updated_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Unable to read Google credentials: ${error.message}`);
  if (!data) return null;
  return {
    id: String(data.id),
    userId,
    googleSubject: data.google_subject ? String(data.google_subject) : null,
    email: data.connected_email ? String(data.connected_email) : null,
    displayName: data.display_name ? String(data.display_name) : null,
    avatarUrl: data.avatar_url ? String(data.avatar_url) : null,
    accountColor: data.account_color ? String(data.account_color) : null,
    access_token: decrypt(String(data.access_token)),
    refresh_token: data.refresh_token
      ? decrypt(String(data.refresh_token))
      : undefined,
    scope: data.scope ? String(data.scope) : undefined,
    token_type: data.token_type ? String(data.token_type) : undefined,
    expires_at: data.expires_at ? Number(data.expires_at) : undefined,
    lastSuccessfulSyncAt: data.last_successful_sync_at ? String(data.last_successful_sync_at) : null,
    lastEmailSyncAt: data.last_email_sync_at ? String(data.last_email_sync_at) : null,
    gmailHistoryId: data.gmail_history_id ? String(data.gmail_history_id) : null,
    calendarTimeZone: data.calendar_time_zone ? String(data.calendar_time_zone) : "UTC",
  } satisfies GoogleAccountRecord;
}

async function refreshGoogleToken(userId: string, token: GoogleAccountRecord) {
  if (!token.refresh_token) {
    throw new Error("Google authorization expired: no refresh token was stored");
  }
  const refreshed = await requestGoogleToken(
    new URLSearchParams({
      refresh_token: token.refresh_token,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    })
  );
  const merged = {
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? token.refresh_token,
  };
  await writeStoredToken(userId, merged, {
    sub: token.googleSubject ?? undefined,
    email: token.email ?? undefined,
    name: token.displayName ?? undefined,
    picture: token.avatarUrl ?? undefined,
  }, token.id);
  return merged;
}

export async function getGoogleAccessToken(
  userId: string,
  accountId?: string,
  forceRefresh = false
) {
  const token = await readStoredGoogleToken(userId, accountId);
  if (!token) throw new Error("Google Calendar is not connected");
  if (
    forceRefresh ||
    !token.expires_at ||
    token.expires_at - Date.now() < 60_000
  ) {
    return (await refreshGoogleToken(userId, token)).access_token;
  }
  return token.access_token;
}

export function googleConfiguration() {
  const missing = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
  ].filter((name) => !process.env[name]?.trim());
  if (
    !process.env.SUPABASE_SECRET_KEY?.trim() &&
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }
  return {
    ready: missing.length === 0,
    missing,
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  };
}
