import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { getAutomationSettings } from "@/lib/automationSettings";
import { createAssistantAction } from "@/lib/objectCreation";
import {
  opportunitySources,
  fetchOfficialOpportunities,
  rankOpportunity,
} from "@/lib/opportunitySources";
// Called under the existing intelligence job's global lease. Never writes a calendar commitment.
export async function discoverOpportunities(userId: string) {
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("A Supabase server key is not configured");
  const settings = await getAutomationSettings(userId);
  if (!settings.discover_opportunities || settings.mode === "manual")
    return { created: 0, errors: [] as string[] };
  const [memory, feedback] = await Promise.all([
    db
      .from("personal_memory")
      .select("category,statement")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(100),
    db
      .from("opportunity_candidates")
      .select("category,feedback_reason")
      .eq("user_id", userId)
      .eq("status", "ignored")
      .limit(100),
  ]);
  if (memory.error) throw memory.error;
  if (feedback.error) throw feedback.error;
  const interests = (memory.data ?? [])
    .filter((row) => /interest|goal|preference/i.test(String(row.category)))
    .flatMap(
      (row) =>
        String(row.statement).match(
          /physics|biology|medicine|biotech|healthcare|surgery|research|engineering|startup|venture capital|machine learning|artificial intelligence|finance|consulting|hackathon/gi,
        ) ?? [],
    );
  const ignored = [
    ...new Set(
      (feedback.data ?? [])
        .filter(
          (row) =>
            row.feedback_reason === "wrong_topic" ||
            row.feedback_reason === "not_relevant",
        )
        .map((row) => row.category),
    ),
  ].filter(
    (category) =>
      (feedback.data ?? []).filter(
        (row) =>
          row.category === category &&
          ["wrong_topic", "not_relevant"].includes(String(row.feedback_reason)),
      ).length >= 3,
  );
  let created = 0;
  const errors: string[] = [];
  for (const source of opportunitySources) {
    const state = await db
      .from("opportunity_discovery_state")
      .select("last_success_at")
      .eq("user_id", userId)
      .eq("source_key", source.key)
      .maybeSingle();
    if (state.error) throw state.error;
    if (
      state.data?.last_success_at &&
      Date.now() - Date.parse(state.data.last_success_at) < 12 * 3600000
    )
      continue;
    const attemptedAt = new Date().toISOString();
    try {
      const events = await fetchOfficialOpportunities(source);
      for (const event of events) {
        const { virtual, ...fields } = event;
        void virtual;
        const ranked = rankOpportunity(event, [...new Set(interests)], ignored);
        const { data, error } = await db
          .from("opportunity_candidates")
          .upsert(
            { user_id: userId, ...fields, ...ranked },
            {
              onConflict: "user_id,source_key,source_id",
              ignoreDuplicates: true,
            },
          )
          .select("id");
        if (error) throw error;
        // Recover a failed action write without resetting a candidate or dismissed action.
        if (ranked.relevance !== "low" && created < 3) {
          const candidate =
            data?.[0] ??
            (
              await db
                .from("opportunity_candidates")
                .select("id,status")
                .eq("user_id", userId)
                .eq("source_key", source.key)
                .eq("source_id", event.source_id)
                .single()
            ).data;
          if (
            !candidate ||
            ("status" in candidate && candidate.status !== "discovered")
          )
            continue;
          const previous = await db
            .from("assistant_action_items")
            .select("id")
            .eq("user_id", userId)
            .eq("source_kind", "opportunity")
            .eq("source_id", candidate.id)
            .eq("action_type", "review_opportunity")
            .maybeSingle();
          if (previous.error) throw previous.error;
          if (previous.data) continue;
          const action = await createAssistantAction(userId, {
            sourceKind: "opportunity",
            sourceId: candidate.id,
            actionType: "review_opportunity",
            title: event.title,
            summary: `${ranked.reasons.join(" ")} ${ranked.travel_note}`,
            priority: "normal",
            payload: {
              sourceUrl: event.source_url,
              startsAt: event.starts_at,
              candidateId: candidate.id,
              registrationConfirmed: false,
            },
          });
          if (action.created) created++;
        }
      }
      const result = await db
        .from("opportunity_discovery_state")
        .upsert({
          user_id: userId,
          source_key: source.key,
          last_attempt_at: attemptedAt,
          last_success_at: new Date().toISOString(),
          error_message: null,
        });
      if (result.error) throw result.error;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Discovery failed";
      errors.push(message);
      const saved = await db
        .from("opportunity_discovery_state")
        .upsert({
          user_id: userId,
          source_key: source.key,
          last_attempt_at: attemptedAt,
          error_message: message,
        });
      if (saved.error) errors.push(saved.error.message);
      console.error(
        JSON.stringify({
          service: "opportunity-discovery",
          source: source.key,
          message,
        }),
      );
    }
  }
  return { created, errors };
}
