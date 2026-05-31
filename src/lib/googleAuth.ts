import { promises as fs } from "fs";
import path from "path";

type GoogleToken = {
  access_token: string;
  expires_in?: number;
  expires_at?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

const TOKEN_PATH = path.join(process.cwd(), ".gmail-token.json");

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export function getGoogleAuthUrl() {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES.join(" "),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function readStoredToken() {
  try {
    return JSON.parse(await fs.readFile(TOKEN_PATH, "utf8")) as GoogleToken;
  } catch {
    return null;
  }
}

async function writeStoredToken(token: GoogleToken) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), "utf8");
}

async function requestGoogleToken(params: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status}`);
  }

  const token = (await response.json()) as GoogleToken;

  return {
    ...token,
    expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
  };
}

export async function exchangeGoogleCode(code: string) {
  const token = await requestGoogleToken(
    new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    })
  );

  await writeStoredToken(token);
  return token;
}

async function refreshGoogleToken(token: GoogleToken) {
  if (!token.refresh_token) {
    throw new Error("No Google refresh token stored");
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

  await writeStoredToken(merged);
  return merged;
}

export async function getGoogleAccessToken() {
  const token = await readStoredToken();

  if (!token) {
    throw new Error("Gmail is not connected");
  }

  if (!token.expires_at || token.expires_at - Date.now() < 60_000) {
    return (await refreshGoogleToken(token)).access_token;
  }

  return token.access_token;
}

export async function isGmailConnected() {
  return Boolean(await readStoredToken());
}
