import { NextRequest, NextResponse, after } from "next/server";
import { requireApiUser, ApiAuthError } from "@/lib/serverAuth";
import {
  createCanonicalTask,
  updateCanonicalTask,
  completeCanonicalTask,
  deleteCanonicalTask,
} from "@/lib/objectCreation";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { syncTaskToGoogle } from "@/lib/googleTasks";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json();
    if (
      !Number.isSafeInteger(body.localId) ||
      body.localId <= 0 ||
      !["create", "update", "complete", "delete"].includes(body.action)
    )
      throw new ApiAuthError("Choose a task and action", 400);
    let result: unknown;
    if (body.action === "create") {
      if (
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.length > 1024
      )
        throw new ApiAuthError("A task title is required", 400);
      if (body.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate))
        throw new ApiAuthError("Invalid due date", 400);
      result = await createCanonicalTask(user.id, {
        sourceKind: "manual",
        sourceId: String(body.localId),
        localId: body.localId,
        title: body.title.trim(),
        priority: ["high", "low", "medium"].includes(body.priority)
          ? body.priority
          : "medium",
        duration:
          Number(body.duration) > 0
            ? Math.min(Number(body.duration), 1440)
            : 60,
        dueDate: body.dueDate ?? null,
      });
    } else if (body.action === "delete")
      result = await deleteCanonicalTask(user.id, body.localId);
    else if (body.action === "complete")
      result = await completeCanonicalTask(user.id, body.localId);
    else {
      const updates: Parameters<typeof updateCanonicalTask>[2] = {};
      if (typeof body.description === "string")
        updates.description = body.description.slice(0, 8192);
      if (["high", "medium", "low"].includes(body.priority))
        updates.priority = body.priority;
      if (Number.isFinite(body.duration) && body.duration > 0)
        updates.duration = Math.min(Math.round(body.duration), 1440);
      if (
        body.dueDate === null ||
        (typeof body.dueDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate))
      )
        updates.due_date = body.dueDate;
      if (
        Array.isArray(body.tags) &&
        body.tags.every((value: unknown) => typeof value === "string")
      )
        updates.tags = body.tags.slice(0, 30);
      if (
        ["none", "daily", "weekly", "weekdays", "weekends", "custom"].includes(
          body.recurrence,
        )
      )
        updates.recurrence = body.recurrence;
      if (
        Array.isArray(body.subtasks) &&
        body.subtasks.length <= 100 &&
        body.subtasks.every(
          (value: { id?: unknown; title?: unknown; done?: unknown }) =>
            Number.isSafeInteger(value.id) &&
            typeof value.title === "string" &&
            typeof value.done === "boolean",
        )
      )
        updates.subtasks = body.subtasks;
      if (typeof body.title === "string")
        updates.title = body.title.slice(0, 1024);
      if (
        ["TODO", "IN_PROGRESS", "WAITING", "COMPLETED", "IGNORED"].includes(
          body.status,
        )
      )
        updates.status = body.status;
      if (body.dueAt === null || typeof body.dueAt === "string") {
        if (body.dueAt !== null && Number.isNaN(Date.parse(body.dueAt)))
          throw new ApiAuthError("Invalid deadline", 400);
        updates.due_at = body.dueAt;
      }
      result = await updateCanonicalTask(user.id, body.localId, updates);
    }
    after(async () => {
      try {
        const db = getServiceSupabaseClient();
        const accounts = await db
          ?.from("google_tokens")
          .select("id")
          .eq("user_id", user.id)
          .eq("tasks_enabled", true)
          .is("disconnected_at", null);
        if (accounts?.error) throw accounts.error;
        for (const account of accounts?.data ?? [])
          await syncTaskToGoogle(user.id, account.id, body.localId);
      } catch (error) {
        console.error(
          JSON.stringify({
            service: "google-tasks",
            stage: "mutation-sync-failed",
            localId: body.localId,
            error: error instanceof Error ? error.message : "Sync failed",
          }),
        );
      }
    });
    return NextResponse.json({ ok: true, task: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Task action failed" },
      { status: error instanceof ApiAuthError ? error.status : 500 },
    );
  }
}
