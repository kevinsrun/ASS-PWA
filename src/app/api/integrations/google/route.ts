import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { verifyGoogleServices } from "@/lib/googleServiceHealth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { plaidConfiguration } from "@/lib/plaid";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ accounts: await verifyGoogleServices(user.id), plaidConfigured: plaidConfiguration().ready }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Connection check failed" }, { status: error instanceof ApiAuthError ? error.status : 500 }); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json();
    if (!body.accountId || !["verify", "disconnect"].includes(body.action)) throw new ApiAuthError("Choose an account and action", 400);
    if (body.action === "verify") return NextResponse.json({ accounts: await verifyGoogleServices(user.id, body.accountId, true) });
    const db = getServiceSupabaseClient();
    if (!db) throw new Error("A Supabase server key is not configured");
    // Keep source records/drafts and canonical objects: deleting this FK parent
    // would cascade into private imported content. Only erase ASS credentials.
    const now = new Date().toISOString();
    const { data, error } = await db.from("google_tokens").update({ disconnected_at: now, access_token: "", refresh_token: null, expires_at: 0, service_health: {}, last_sync_status: "error", last_sync_error: "Disconnected by user" }).eq("user_id", user.id).eq("id", body.accountId).is("disconnected_at", null).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiAuthError("Connected Google account not found", 404);
    const { error: registryError } = await db.from("connected_accounts").update({ sync_status: "disconnected", last_sync_error: "Disconnected by user", updated_at: now }).eq("id", data.id).eq("user_id", user.id);
    if (registryError) throw registryError;
    return NextResponse.json({ disconnected: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Connection action failed" }, { status: error instanceof ApiAuthError ? error.status : 500 }); }
}
