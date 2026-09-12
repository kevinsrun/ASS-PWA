import { NextRequest, NextResponse } from "next/server";
import { addMinutesToLabel, formatTimeLabel } from "@/lib/dateTime";
import { createGoogleCalendarEvent } from "@/lib/googleCalendarSync";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import type { EmailIntelligenceItem, SavedPlan } from "@/lib/types";

function failure(error: unknown) {
  const status = error instanceof ApiAuthError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Intelligence request failed.";
  console.error(JSON.stringify({ service: "intelligence-feed", stage: "failed", message }));
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const [{ data, error }, accounts] = await Promise.all([
      supabase
        .from("email_suggestions")
        .select("id,google_account_id,sender,title,summary,intelligence_type,importance,action_required,date,time,conflict_details,recommendations,received_at")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .neq("intelligence_type", "no_action")
        .order("received_at", { ascending: false })
        .limit(8),
      supabase.from("google_tokens").select("id,connected_email").eq("user_id", user.id),
    ]);
    if (error) throw error;
    if (accounts.error) throw accounts.error;
    const emailByAccount = new Map(
      (accounts.data ?? []).map((account) => [String(account.id), String(account.connected_email ?? "Google account")])
    );
    const items: EmailIntelligenceItem[] = (data ?? []).map((item) => ({
      id: String(item.id),
      accountEmail: emailByAccount.get(String(item.google_account_id)) ?? "Google account",
      sender: String(item.sender ?? ""),
      title: String(item.title),
      summary: String(item.summary ?? ""),
      type: item.intelligence_type as EmailIntelligenceItem["type"],
      importance: item.importance as EmailIntelligenceItem["importance"],
      actionRequired: Boolean(item.action_required),
      date: item.date ? String(item.date) : null,
      time: item.time ? String(item.time) : null,
      conflictDetails: Array.isArray(item.conflict_details) ? item.conflict_details.map(String) : [],
      recommendations: Array.isArray(item.recommendations) ? item.recommendations.map(String) : [],
      receivedAt: item.received_at ? String(item.received_at) : null,
    }));
    return NextResponse.json({ items });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = (await request.json()) as { id?: string; action?: "accept" | "dismiss" };
    if (!body.id || !body.action || !["accept", "dismiss"].includes(body.action)) {
      throw new ApiAuthError("An insight and valid action are required.", 400);
    }
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const { data: item, error } = await supabase
      .from("email_suggestions")
      .select("*")
      .eq("id", body.id)
      .eq("user_id", user.id)
      .single();
    if (error || !item) throw new ApiAuthError("Insight not found.", 404);
    if (body.action === "accept") {
      const eventLike = ["meeting", "club_event", "interview", "travel"].includes(String(item.intelligence_type));
      if (eventLike && item.date && item.time) {
        const plan: SavedPlan = {
          id: Date.now(),
          title: String(item.title),
          date: String(item.date),
          startLabel: formatTimeLabel(String(item.time)),
          endLabel: addMinutesToLabel(String(item.time), Number(item.duration ?? 60)),
          recurrence: "none",
          category: (item.category ?? "other") as SavedPlan["category"],
          priority: item.importance === "urgent" || item.importance === "high" ? "high" : "medium",
          notes: String(item.summary ?? item.source ?? ""),
          source: "ass",
          googleAccountId: item.google_account_id ? String(item.google_account_id) : undefined,
        };
        await createGoogleCalendarEvent(user.id, plan);
      } else {
        const { error: todoError } = await supabase.from("todos").insert({
          user_id: user.id,
          local_id: Date.now(),
          title: String(item.title),
          done: false,
          priority: item.importance === "urgent" || item.importance === "high" ? "high" : "medium",
          duration: Number(item.duration ?? 60),
          due_date: item.date ?? null,
          tags: [String(item.intelligence_type), "email"],
          recurrence: "none",
          subtasks: [],
        });
        if (todoError) throw todoError;
      }
    }
    const { error: updateError } = await supabase
      .from("email_suggestions")
      .update({ status: body.action === "accept" ? "accepted" : "dismissed" })
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
