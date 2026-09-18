import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, ApiAuthError } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { getGoogleAuthUrl } from "@/lib/googleAuth";
import { syncGoogleTasks } from "@/lib/googleTasks";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const db = getServiceSupabaseClient();
    if (!db) throw new Error("Cloud Tasks is not configured");
    const accounts = await db
      .from("google_tokens")
      .select("id,connected_email,tasks_enabled,scope,service_health")
      .eq("user_id", user.id)
      .is("disconnected_at", null);
    if (accounts.error) throw accounts.error;
    return NextResponse.json(
      {
        accounts: (accounts.data ?? []).map((account) => ({
          id: account.id,
          email: account.connected_email,
          enabled: account.tasks_enabled,
          health: account.service_health?.tasks ?? null,
          permissionGranted: String(account.scope ?? "")
            .split(/\s+/)
            .includes("https://www.googleapis.com/auth/tasks"),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Tasks status failed" },
      { status: error instanceof ApiAuthError ? error.status : 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json();
    if (
      typeof body.accountId !== "string" ||
      !["enable", "disable", "sync"].includes(body.action)
    )
      throw new ApiAuthError(
        "Choose a connected account and Tasks action",
        400,
      );
    const db = getServiceSupabaseClient();
    if (!db) throw new Error("Cloud Tasks is not configured");
    const owned = await db
      .from("google_tokens")
      .select("id")
      .eq("user_id", user.id)
      .eq("id", body.accountId)
      .is("disconnected_at", null)
      .single();
    if (owned.error || !owned.data)
      throw new ApiAuthError("Connected account not found", 404);
    if (body.action === "sync")
      return NextResponse.json(await syncGoogleTasks(user.id, body.accountId));
    if (body.action === "enable") {
      const others = await db
        .from("google_tokens")
        .select("id")
        .eq("user_id", user.id)
        .eq("tasks_enabled", true)
        .neq("id", body.accountId)
        .is("disconnected_at", null);
      if (others.error) throw others.error;
      if (others.data?.length)
        throw new ApiAuthError(
          "Disable Tasks sync on the other account first; ASS uses one task destination to prevent duplicates.",
          409,
        );
    }
    const saved = await db
      .from("google_tokens")
      .update({ tasks_enabled: body.action === "enable" })
      .eq("user_id", user.id)
      .eq("id", body.accountId);
    if (saved.error) throw saved.error;
    return NextResponse.json(
      body.action === "enable"
        ? { url: getGoogleAuthUrl(user.id, true) }
        : { disabled: true },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Tasks sync failed" },
      { status: error instanceof ApiAuthError ? error.status : 500 },
    );
  }
}
