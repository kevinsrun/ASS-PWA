import { getGoogleAccessToken, listGoogleAccounts } from "@/lib/googleAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
export type ServiceHealth = { state: "connected" | "failed" | "reconnect" | "unverified"; checkedAt: string | null; lastSuccessfulApiAt: string | null; error: string | null };
export type GoogleServiceHealth = { id: string; email: string; gmail: ServiceHealth; drive: ServiceHealth; calendar: ServiceHealth; lastGmailSync: string | null; lastCalendarSync: string | null; lastDriveSync: string | null };
const fresh = (item?: ServiceHealth) => Boolean(item?.checkedAt && Date.now() - Date.parse(item.checkedAt) < 5 * 60_000);
const unverified = (): ServiceHealth => ({ state: "unverified", checkedAt: null, lastSuccessfulApiAt: null, error: null });
export async function verifyGoogleServices(userId: string, onlyAccountId?: string, force = false): Promise<GoogleServiceHealth[]> {
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("A Supabase server key is not configured");
  const accounts = (await listGoogleAccounts(userId)).filter(account => !onlyAccountId || String(account.id) === onlyAccountId);
  if (onlyAccountId && !accounts.length) throw new Error("This Google account does not belong to the signed-in user");
  return Promise.all(accounts.map(async account => {
    const id = String(account.id);
    const { data: stored, error: readError } = await db.from("google_tokens").select("service_health").eq("user_id", userId).eq("id", id).single();
    if (readError) throw readError;
    const previous = (stored?.service_health ?? {}) as Record<string, ServiceHealth>;
    const health: Record<string, ServiceHealth> = { ...previous };
    const services = ["gmail", "drive", "calendar"] as const;
    if (force || services.some(service => !fresh(previous[service]))) {
      let token: string | undefined, tokenError: string | undefined;
      try { token = await getGoogleAccessToken(userId, id); }
      catch (error) { tokenError = error instanceof Error ? error.message : "Authentication failed"; }
      const urls = { gmail: "https://gmail.googleapis.com/gmail/v1/users/me/profile", drive: "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&q=%27root%27%20in%20parents%20and%20trashed%3Dfalse", calendar: "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1&fields=items(id)" };
      await Promise.all(services.map(async service => {
        if (!force && fresh(previous[service])) return;
        const checkedAt = new Date().toISOString();
        try {
          if (!token) throw new Error(tokenError ?? "Reconnect Google account");
          const response = await fetch(urls[service], { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            const reason = body.error?.errors?.[0]?.reason ?? "";
            const message = /insufficient|scope/i.test(`${reason} ${body.error?.message}`) ? `Missing ${service} permission. Reconnect this Google account and allow ${service} access.` : /accessNotConfigured|SERVICE_DISABLED/i.test(`${reason} ${JSON.stringify(body.error?.details ?? [])}`) ? `${service} API is disabled in the OAuth Google Cloud project. Enable it and retry.` : `Google ${service} API returned HTTP ${response.status}: ${String(body.error?.message ?? reason).slice(0,200)}`;
            health[service] = { state: response.status === 401 || /permission|scope/i.test(message) ? "reconnect" : "failed", checkedAt, lastSuccessfulApiAt: previous[service]?.lastSuccessfulApiAt ?? null, error: message };
          } else {
            if (service === "gmail" && (!body.emailAddress || String(body.emailAddress).toLowerCase() !== String(account.connected_email).toLowerCase())) throw new Error("Authenticated Gmail identity does not match this connected account. Reconnect it.");
            if (service !== "gmail" && !Array.isArray(body[service === "drive" ? "files" : "items"])) throw new Error(`Google ${service} returned an invalid response`);
            health[service] = { state: "connected", checkedAt, lastSuccessfulApiAt: checkedAt, error: null };
          }
        } catch (error) {
          health[service] = { state: /refresh|revoked|invalid_grant|reconnect/i.test(String(error)) ? "reconnect" : "failed", checkedAt, lastSuccessfulApiAt: previous[service]?.lastSuccessfulApiAt ?? null, error: error instanceof Error ? error.message : "Unable to reach Google" };
        }
        console.info(JSON.stringify({ service: "google-service-health", account: id.slice(0,8), integration: service, state: health[service].state, error: health[service].error }));
      }));
      const { error } = await db.from("google_tokens").update({ service_health: health }).eq("user_id", userId).eq("id", id);
      if (error) throw error;
    }
    const { data: driveState } = await db.from("drive_sync_state").select("last_successful_sync_at").eq("user_id", userId).eq("google_account_id", id).maybeSingle();
    return { id, email: String(account.connected_email ?? "Google account"), gmail: health.gmail ?? unverified(), drive: health.drive ?? unverified(), calendar: health.calendar ?? unverified(), lastGmailSync: account.last_email_sync_at ? String(account.last_email_sync_at) : null, lastCalendarSync: account.last_successful_sync_at ? String(account.last_successful_sync_at) : null, lastDriveSync: driveState?.last_successful_sync_at ?? null };
  }));
}
