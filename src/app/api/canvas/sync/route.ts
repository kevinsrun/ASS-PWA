import { NextResponse } from "next/server";
import { fetchCanvasSnapshot } from "@/lib/canvas";
import { academicSnapshotFromRows } from "@/lib/academic";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 60;

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

export async function POST(request: Request) {
  const supabase = getServiceSupabaseClient();
  const token = bearerToken(request);

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase server credentials are not configured." },
      { status: 503 }
    );
  }

  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  const syncStartedAt = new Date().toISOString();

  try {
    const canvas = await fetchCanvasSnapshot();
    const courseRows = canvas.courses.map((course) => ({
      ...course,
      user_id: user.id,
      updated_at: syncStartedAt,
    }));

    const { data: persistedCourses, error: courseError } = await supabase
      .from("academic_courses")
      .upsert(courseRows, { onConflict: "user_id,canvas_id" })
      .select("id,canvas_id");
    if (courseError) throw courseError;

    const courseIds = new Map(
      (persistedCourses ?? []).map((course) => [Number(course.canvas_id), course.id as string])
    );
    const assignmentRows = canvas.assignments
      .map((assignment) => ({
        ...assignment,
        user_id: user.id,
        course_id: courseIds.get(assignment.course_canvas_id),
        updated_at: syncStartedAt,
      }))
      .filter((assignment) => Boolean(assignment.course_id));
    const resourceRows = canvas.resources
      .map((resource) => ({
        ...resource,
        user_id: user.id,
        course_id: resource.course_canvas_id
          ? courseIds.get(resource.course_canvas_id)
          : null,
        updated_at: syncStartedAt,
      }))
      .filter((resource) => resource.course_canvas_id === null || Boolean(resource.course_id));

    const [assignmentResult, resourceResult] = await Promise.all([
      assignmentRows.length
        ? supabase
            .from("academic_assignments")
            .upsert(assignmentRows, { onConflict: "user_id,canvas_id" })
        : Promise.resolve({ error: null }),
      resourceRows.length
        ? supabase
            .from("academic_resources")
            .upsert(resourceRows, {
              onConflict: "user_id,resource_type,external_id,course_canvas_id",
            })
        : Promise.resolve({ error: null }),
    ]);
    if (assignmentResult.error) throw assignmentResult.error;
    if (resourceResult.error) throw resourceResult.error;

    await supabase.from("academic_sync_runs").insert({
      user_id: user.id,
      status: "ok",
      started_at: syncStartedAt,
      completed_at: new Date().toISOString(),
      records: {
        courses: courseRows.length,
        assignments: assignmentRows.length,
        resources: resourceRows.length,
      },
    });

    const [courses, assignments, resources] = await Promise.all([
      supabase.from("academic_courses").select("*").eq("user_id", user.id).order("name"),
      supabase
        .from("academic_assignments")
        .select("*")
        .eq("user_id", user.id)
        .order("due_at", { ascending: true, nullsFirst: false }),
      supabase
        .from("academic_resources")
        .select("*")
        .eq("user_id", user.id)
        .order("published_at", { ascending: false, nullsFirst: false }),
    ]);

    if (courses.error || assignments.error || resources.error) {
      throw courses.error ?? assignments.error ?? resources.error;
    }

    return NextResponse.json(
      academicSnapshotFromRows(
        courses.data ?? [],
        assignments.data ?? [],
        resources.data ?? [],
        new Date().toISOString()
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Canvas sync failed.";
    console.error("Canvas sync failed:", error);
    await supabase.from("academic_sync_runs").insert({
      user_id: user.id,
      status: "error",
      started_at: syncStartedAt,
      completed_at: new Date().toISOString(),
      error_message: message,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
