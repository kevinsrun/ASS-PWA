import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export type GoogleToken = {
  access_token: string;
  expires_in?: number;
  expires_at?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type OAuthState = { userId: string; expiresAt: number; nonce: string };

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
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

async function writeStoredToken(userId: string, token: GoogleToken) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { error } = await supabase.from("google_tokens").upsert({
    user_id: userId,
    access_token: encrypt(token.access_token),
    refresh_token: token.refresh_token ? encrypt(token.refresh_token) : null,
    scope: token.scope ?? null,
    token_type: token.token_type ?? "Bearer",
    expires_at: token.expires_at ?? null,
    last_sync_status: "ready",
    last_sync_error: null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Unable to store Google credentials: ${error.message}`);
  }
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
  await writeStoredToken(userId, token);
  return token;
}

export async function readStoredGoogleToken(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data, error } = await supabase
    .from("google_tokens")
    .select("access_token,refresh_token,scope,token_type,expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Unable to read Google credentials: ${error.message}`);
  if (!data) return null;
  return {
    access_token: decrypt(String(data.access_token)),
    refresh_token: data.refresh_token
      ? decrypt(String(data.refresh_token))
      : undefined,
    scope: data.scope ? String(data.scope) : undefined,
    token_type: data.token_type ? String(data.token_type) : undefined,
    expires_at: data.expires_at ? Number(data.expires_at) : undefined,
  } satisfies GoogleToken;
}

async function refreshGoogleToken(userId: string, token: GoogleToken) {
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
  await writeStoredToken(userId, merged);
  return merged;
}

export async function getGoogleAccessToken(
  userId: string,
  forceRefresh = false
) {
  const token = await readStoredGoogleToken(userId);
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
