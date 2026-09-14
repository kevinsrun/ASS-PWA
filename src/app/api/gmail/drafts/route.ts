import { NextRequest, NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/googleAuth";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { recordClassificationFeedback } from "@/lib/objectCreation";

function encodeMessage(headers: Record<string, string | null>, body: string) {
  const lines = Object.entries(headers).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([name, value]) => `${name}: ${value.replace(/[\r\n]+/g, " ")}`);
  return Buffer.from(`${lines.join("\r\n")}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`, "utf8").toString("base64url");
}

export async function GET(request: NextRequest) {
  try { const user = await requireApiUser(request); const supabase = getServiceSupabaseClient(); if (!supabase) throw new Error("A Supabase server key is not configured"); const { data, error } = await supabase.from("email_drafts").select("id,google_account_id,thread_id,recipient,subject,body,status,gmail_draft_id,created_at").eq("user_id", user.id).in("status", ["ready", "edited"]).order("created_at", { ascending: false }).limit(20); if (error) throw error; return NextResponse.json({ drafts: data ?? [] }); }
  catch (error) { const message = error instanceof Error ? error.message : "Drafts are unavailable."; return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request); const body = await request.json() as { id?: string; action?: "save" | "ignore"; draftBody?: string }; if (!body.id || !body.action) throw new ApiAuthError("Choose a draft and action.", 400);
    const supabase = getServiceSupabaseClient(); if (!supabase) throw new Error("A Supabase server key is not configured");
    const { data: draft, error } = await supabase.from("email_drafts").select("*").eq("id", body.id).eq("user_id", user.id).single(); if (error || !draft) throw new ApiAuthError("Draft not found.", 404);
    const editedBody = String(body.draftBody ?? draft.body).trim();
    if (body.action === "ignore") { const { error: ignoreError } = await supabase.from("email_drafts").update({ status: "no_response_needed", updated_at: new Date().toISOString() }).eq("id", body.id).eq("user_id", user.id); if (ignoreError) throw ignoreError; await recordClassificationFeedback(user.id, { sourceType: "email_draft", sourceId: String(draft.id), originalText: `${String(draft.subject)}\n${String(draft.body)}`, predictedLabel: "response_needed", correctedLabel: "no_response_needed", userAction: "ignore" }); return NextResponse.json({ ok: true }); }
    if (!draft.recipient) throw new ApiAuthError("This email has no valid reply address.", 400);
    const token = await getGoogleAccessToken(user.id, String(draft.google_account_id));
    const raw = encodeMessage({ To: String(draft.recipient), Subject: String(draft.subject), "In-Reply-To": draft.in_reply_to_message_id ? String(draft.in_reply_to_message_id) : null, References: draft.in_reply_to_message_id ? String(draft.in_reply_to_message_id) : null }, editedBody);
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: { threadId: draft.thread_id ?? undefined, raw } }), cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } }; if (!response.ok || !result.id) throw new Error(result.error?.message || `Gmail draft creation failed: HTTP ${response.status}`);
    const { error: updateError } = await supabase.from("email_drafts").update({ body: editedBody, status: "saved_to_gmail", gmail_draft_id: result.id, updated_at: new Date().toISOString() }).eq("id", body.id).eq("user_id", user.id); if (updateError) throw updateError;
    await recordClassificationFeedback(user.id, { sourceType: "email_draft", sourceId: String(draft.id), originalText: `${String(draft.subject)}\n${String(draft.body)}`, predictedLabel: "response_needed", correctedLabel: "response_needed", userAction: editedBody === String(draft.body).trim() ? "accepted" : "edited", context: { edited: editedBody !== String(draft.body).trim() } });
    console.info(JSON.stringify({ service: "gmail-drafts", stage: "saved", draftId: body.id, gmailDraftId: result.id, sent: false }));
    return NextResponse.json({ ok: true, gmailDraftId: result.id });
  } catch (error) { const message = error instanceof Error ? error.message : "Could not save the Gmail draft."; console.error(JSON.stringify({ service: "gmail-drafts", stage: "failed", message })); return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 }); }
}
