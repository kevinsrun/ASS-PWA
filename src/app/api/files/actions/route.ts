import { NextRequest, NextResponse } from "next/server";
import { commitExtractionItem } from "@/lib/fileIntelligence";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { itemId?: string; action?: "approve" | "reject" };
    if (!body.itemId || !body.action || !["approve", "reject"].includes(body.action)) throw new ApiAuthError("Choose an extracted item and an action.", 400);
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const { data: item, error } = await supabase.from("extraction_items").select("id,title,item_type,confidence,review_status").eq("id", body.itemId).eq("user_id", user.id).single();
    if (error || !item) throw new ApiAuthError("Extracted item not found.", 404);
    if (body.action === "approve") {
      await supabase.from("extraction_items").update({ review_status: "approved", updated_at: new Date().toISOString() }).eq("id", body.itemId).eq("user_id", user.id);
      await commitExtractionItem(user.id, body.itemId);
    } else {
      const { error: rejectError } = await supabase.from("extraction_items").update({ review_status: "rejected", updated_at: new Date().toISOString() }).eq("id", body.itemId).eq("user_id", user.id);
      if (rejectError) throw rejectError;
    }
    await supabase.from("event_decisions").upsert({
      user_id: user.id, source_kind: "file", source_id: body.itemId, decision: body.action,
      context: { title: item.title, itemType: item.item_type, confidence: item.confidence }, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,source_kind,source_id" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not update this item.";
    console.error(JSON.stringify({ service: "file-intelligence", stage: "review-action-failed", message }));
    return NextResponse.json({ error: message }, { status });
  }
}
