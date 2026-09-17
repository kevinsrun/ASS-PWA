import { NextRequest, NextResponse } from "next/server";
import { createGmailDraft } from "@/lib/gmailDrafts";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { recordClassificationFeedback } from "@/lib/objectCreation";

export async function GET(request: NextRequest) {
  try { const user = await requireApiUser(request); const supabase = getServiceSupabaseClient(); if (!supabase) throw new Error("A Supabase server key is not configured"); const { data, error } = await supabase.from("email_drafts").select("id,google_account_id,thread_id,recipient,subject,body,status,gmail_draft_id,created_at").eq("user_id", user.id).in("status", ["ready", "edited"]).order("created_at", { ascending: false }).limit(20); if (error) throw error; return NextResponse.json({ drafts: data ?? [] }); }
  catch (error) { const message = error instanceof Error ? error.message : "Drafts are unavailable."; return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request); const body = await request.json() as { id?: string; action?: "save" | "ignore"; draftBody?: string }; if (!body.id || !["save","ignore"].includes(body.action ?? "")) throw new ApiAuthError("Choose a draft and valid action.", 400);
    const supabase = getServiceSupabaseClient(); if (!supabase) throw new Error("A Supabase server key is not configured");
    const { data: draft, error } = await supabase.from("email_drafts").select("*").eq("id", body.id).eq("user_id", user.id).single(); if (error || !draft) throw new ApiAuthError("Draft not found.", 404);
    const editedBody = String(body.draftBody ?? draft.body).trim();
    if (body.action === "ignore") { const { error: ignoreError } = await supabase.from("email_drafts").update({ status: "no_response_needed", updated_at: new Date().toISOString() }).eq("id", body.id).eq("user_id", user.id); if (ignoreError) throw ignoreError; await recordClassificationFeedback(user.id, { sourceType: "email_draft", sourceId: String(draft.id), originalText: `${String(draft.subject)}\n${String(draft.body)}`, predictedLabel: "response_needed", correctedLabel: "no_response_needed", userAction: "ignore" }); return NextResponse.json({ ok: true }); }
    if (!draft.recipient) throw new ApiAuthError("This email has no valid reply address.", 400);
    const result=await createGmailDraft(user.id,body.id,editedBody);
    await recordClassificationFeedback(user.id, { sourceType: "email_draft", sourceId: String(draft.id), originalText: `${String(draft.subject)}\n${String(draft.body)}`, predictedLabel: "response_needed", correctedLabel: "response_needed", userAction: editedBody === String(draft.body).trim() ? "accepted" : "edited", context: { edited: editedBody !== String(draft.body).trim() } });
    console.info(JSON.stringify({ service: "gmail-drafts", stage: "saved", draftId: body.id, gmailDraftId: result.gmailDraftId, sent: false }));
    return NextResponse.json({ ok: true, gmailDraftId: result.gmailDraftId });
  } catch (error) { const message = error instanceof Error ? error.message : "Could not save the Gmail draft."; console.error(JSON.stringify({ service: "gmail-drafts", stage: "failed", message })); return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 }); }
}
