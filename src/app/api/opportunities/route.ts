import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
export const runtime = "nodejs";
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Opportunity request failed",
    },
    { status: error instanceof ApiAuthError ? error.status : 500 },
  );
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request),
      db = getServiceSupabaseClient();
    if (!db) throw new Error("A Supabase server key is not configured");
    const [candidates, sources] = await Promise.all([
      db
        .from("opportunity_candidates")
        .select("*")
        .eq("user_id", user.id)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(100),
      db
        .from("opportunity_discovery_state")
        .select("source_key,last_attempt_at,last_success_at,error_message")
        .eq("user_id", user.id),
    ]);
    if (candidates.error) throw candidates.error;
    if (sources.error) throw sources.error;
    return NextResponse.json(
      {
        candidates: candidates.data,
        sources: sources.data,
        coverage: ["MIT official calendar"],
        calendarWrites: false,
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
      body = await request.json(),
      db = getServiceSupabaseClient();
    if (!db) throw new Error("A Supabase server key is not configured");
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) => !["id", "status", "feedbackReason"].includes(key),
      ) ||
      typeof body.id !== "string" ||
      !["interested", "maybe", "ignored", "registration_pending"].includes(
        body.status,
      ) ||
      (body.feedbackReason != null &&
        !["not_relevant", "too_costly", "too_far", "wrong_topic"].includes(
          body.feedbackReason,
        ))
    )
      throw new ApiAuthError(
        "Provide a candidate ID and valid review decision",
        400,
      );
    const result = await db
      .from("opportunity_candidates")
      .update({
        status: body.status,
        feedback_reason:
          body.status === "ignored" ? (body.feedbackReason ?? null) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("id", body.id)
      .select("id,status")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new ApiAuthError("Opportunity not found", 404);
    return NextResponse.json({
      candidate: result.data,
      registrationConfirmed: false,
      calendarWrites: false,
    });
  } catch (error) {
    return failure(error);
  }
}
