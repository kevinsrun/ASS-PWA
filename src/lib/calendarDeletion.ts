import { deleteGoogleCalendarEvent } from "@/lib/googleCalendarSync";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export async function deleteCanonicalEvent(userId: string, input: {
  canonicalEventId?: string; localId?: number; googleCalendarId?: string; googleEventId?: string;
  googleAccountId?: string; deleteFromGoogle?: boolean;
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data: plan, error: planLookupError } = await supabase.from("plans")
    .select("canonical_event_id,google_calendar_id,google_event_id,google_account_id,source")
    .eq("user_id", userId).eq("local_id", input.localId ?? -1).maybeSingle();
  if (planLookupError) throw planLookupError;
  const canonicalEventId = input.canonicalEventId ?? plan?.canonical_event_id ?? undefined;
  const googleCalendarId = input.googleCalendarId ?? plan?.google_calendar_id ?? undefined;
  const googleEventId = input.googleEventId ?? plan?.google_event_id ?? undefined;
  const googleAccountId = input.googleAccountId ?? plan?.google_account_id ?? undefined;
  if (!canonicalEventId && input.localId == null) throw new Error("A canonical event or local plan ID is required.");

  let googleStatus: Awaited<ReturnType<typeof deleteGoogleCalendarEvent>> | null = null;
  if (input.deleteFromGoogle) {
    if (!googleCalendarId || !googleEventId) throw new Error("This event is not linked to a writable Google event.");
    googleStatus = await deleteGoogleCalendarEvent(userId, googleCalendarId, googleEventId, googleAccountId);
    if (googleStatus.state !== "synced") throw new Error(googleStatus.error || "Google did not confirm deletion.");
  }

  const now = new Date().toISOString();
  if (canonicalEventId) {
    const { data: sources, error: sourceLookupError } = await supabase.from("event_sources").select("source_kind,source_id").eq("user_id", userId).eq("canonical_event_id", canonicalEventId);
    if (sourceLookupError) throw sourceLookupError;
    const { error: sourceError } = await supabase.from("event_sources").update({
      deleted_at: now, source_deleted: Boolean(input.deleteFromGoogle), ignore_future_imports: true, updated_at: now,
    }).eq("user_id", userId).eq("canonical_event_id", canonicalEventId);
    if (sourceError) throw sourceError;
    for (const source of sources ?? []) {
      if (["file", "text", "drive"].includes(String(source.source_kind))) {
        await supabase.from("extraction_items").update({ deleted_at: now, ignore_future_imports: true, conversion_error: "Calendar item deleted by user", updated_at: now }).eq("id", source.source_id).eq("user_id", userId);
      }
    }
    const { error: canonicalError } = await supabase.from("canonical_events").update({
      deleted_at: now, deleted_by_user: true, hidden_from_calendar: true,
      deletion_reason: input.deleteFromGoogle ? "deleted_from_google" : "hidden_locally", updated_at: now,
    }).eq("id", canonicalEventId).eq("user_id", userId);
    if (canonicalError) throw canonicalError;
    const { error: planDeleteError } = await supabase.from("plans").delete().eq("canonical_event_id", canonicalEventId).eq("user_id", userId);
    if (planDeleteError) throw planDeleteError;
  } else {
    const { error } = await supabase.from("plans").delete().eq("local_id", input.localId!).eq("user_id", userId);
    if (error) throw error;
  }
  if (googleCalendarId && googleEventId) {
    let query = supabase.from("calendar_event_sources").update({ deleted_at: now, source_deleted: Boolean(input.deleteFromGoogle), ignore_future_imports: true })
      .eq("user_id", userId).eq("calendar_id", googleCalendarId).eq("google_event_id", googleEventId);
    if (googleAccountId) query = query.eq("google_account_id", googleAccountId);
    const { error } = await query;
    if (error) throw error;
  }
  console.info(JSON.stringify({ service: "calendar-deletion", stage: "deleted", canonicalEventId: canonicalEventId ?? null, localId: input.localId ?? null, deleteFromGoogle: Boolean(input.deleteFromGoogle) }));
  return { ok: true, hiddenLocally: !input.deleteFromGoogle, googleDeleted: Boolean(input.deleteFromGoogle), googleStatus };
}
