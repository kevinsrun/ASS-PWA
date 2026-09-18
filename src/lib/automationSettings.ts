import { getServiceSupabaseClient } from "@/lib/supabaseServer";
export type AutomationSettings = {
  mode: "aggressive" | "balanced" | "manual";
  mark_processed_read: boolean;
  archive_junk: boolean;
  unsubscribe_junk: boolean;
  create_deadlines: boolean;
  create_reply_drafts: boolean;
  discover_opportunities: boolean;
};
export const defaultAutomationSettings: AutomationSettings = {
  mode: "balanced",
  mark_processed_read: true,
  archive_junk: false,
  unsubscribe_junk: false,
  create_deadlines: true,
  create_reply_drafts: true,
  discover_opportunities: true,
};
export const gmailModifyScope = "https://www.googleapis.com/auth/gmail.modify";
export function canModifyGmail(scope?: string | null) {
  return String(scope ?? "")
    .split(/\s+/)
    .includes(gmailModifyScope);
}
export async function getAutomationSettings(
  userId: string,
): Promise<AutomationSettings> {
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("A Supabase server key is not configured");
  const { data, error } = await db
    .from("automation_settings")
    .select(
      "mode,mark_processed_read,archive_junk,unsubscribe_junk,create_deadlines,create_reply_drafts,discover_opportunities",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return { ...defaultAutomationSettings, ...data };
}
