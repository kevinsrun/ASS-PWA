import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import {
  canModifyGmail,
  defaultAutomationSettings,
  getAutomationSettings,
} from "@/lib/automationSettings";
import { listGoogleAccounts } from "@/lib/googleAuth";
export const runtime = "nodejs";
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Automation request failed",
    },
    { status: error instanceof ApiAuthError ? error.status : 500 },
  );
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request),
      db = getServiceSupabaseClient();
    if (!db) throw new Error("A Supabase server key is not configured");
    const [settings, accounts, audit, suppressed] = await Promise.all([
      getAutomationSettings(user.id),
      listGoogleAccounts(user.id),
      db
        .from("automation_audit")
        .select(
          "id,source_id,action,status,reason,confidence,error_message,reversible,created_at,completed_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("email_suggestions")
        .select("id,title,sender,summary,received_at,disposition")
        .eq("user_id", user.id)
        .eq("suppressed", true)
        .order("received_at", { ascending: false })
        .limit(50),
    ]);
    if (audit.error) throw audit.error;
    if (suppressed.error) throw suppressed.error;
    return NextResponse.json(
      {
        settings,
        accounts: accounts.map((account) => ({
          id: account.id,
          email: account.connected_email,
          canModifyGmail: canModifyGmail(
            account.scope ? String(account.scope) : null,
          ),
        })),
        audit: audit.data ?? [],
        suppressed: suppressed.data ?? [],
        restricted: {
          automatic_send: false,
          automatic_form_submission: false,
          automatic_external_event_deletion: false,
        },
        unsubscribeAvailable: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request),
      body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiAuthError("Provide automation settings", 400);
    for (const [key, value] of Object.entries(body)) {
      if (!Object.hasOwn(defaultAutomationSettings, key))
        throw new ApiAuthError(
          `Unsupported automation permission: ${key}`,
          400,
        );
      if (
        key === "mode"
          ? !["aggressive", "balanced", "manual"].includes(String(value))
          : typeof value !== "boolean"
      )
        throw new ApiAuthError(`Invalid automation setting: ${key}`, 400);
    }
    const db = getServiceSupabaseClient();
    if (!db) throw new Error("A Supabase server key is not configured");
    const current = await getAutomationSettings(user.id);
    const { data, error } = await db
      .from("automation_settings")
      .upsert(
        {
          user_id: user.id,
          ...current,
          ...body,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select(
        "mode,mark_processed_read,archive_junk,unsubscribe_junk,create_deadlines,create_reply_drafts",
      )
      .single();
    if (error) throw error;
    return NextResponse.json({ settings: data });
  } catch (error) {
    return failure(error);
  }
}
