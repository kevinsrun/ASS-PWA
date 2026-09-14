import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export async function mobileSnapshot(userId: string) {
  const supabase = getServiceSupabaseClient(); if (!supabase) throw new Error("A Supabase server key is not configured");
  const today = new Date().toISOString().slice(0, 10);
  const [profile, plans, todos, actions, finance] = await Promise.all([
    supabase.from("profiles").select("display_name,primary_email").eq("user_id", userId).maybeSingle(),
    supabase.from("plans").select("local_id,canonical_event_id,title,date,start_label,end_label,category,priority,all_day,optionality,attendance_policy,classification_confidence,classification_reason,source_label,blocking_status").eq("user_id", userId).gte("date", today).order("date").order("start_label").limit(300),
    supabase.from("todos").select("local_id,title,due_date,priority,done,duration").eq("user_id", userId).eq("done", false).order("due_date").limit(100),
    supabase.from("assistant_action_items").select("id,action_type,title,summary,priority,payload,status,created_at").eq("user_id", userId).eq("status", "pending").order("created_at", { ascending: false }).limit(30),
    supabase.from("financial_runway_snapshots").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = [profile, plans, todos, actions, finance].find((result) => result.error)?.error; if (error) throw error;
  return { profile: profile.data, today, todayEvents: (plans.data ?? []).filter((item) => item.date === today), upcomingEvents: plans.data ?? [], tasks: todos.data ?? [], assistantActions: actions.data ?? [], finance: finance.data ?? null };
}
