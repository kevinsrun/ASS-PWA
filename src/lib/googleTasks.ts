import { randomUUID } from "crypto";
import { getGoogleAccessToken, readStoredGoogleToken } from "@/lib/googleAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
export const googleTasksScope = "https://www.googleapis.com/auth/tasks";
type RemoteTask = {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: string;
  updated?: string;
  deleted?: boolean;
};
export async function syncGoogleTasks(
  userId: string,
  accountId: string,
  onlyLocalId?: number,
) {
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("Cloud Tasks is not configured");
  const { data: account, error } = await db
    .from("google_tokens")
    .select("id,tasks_enabled,google_tasklist_id,scope")
    .eq("user_id", userId)
    .eq("id", accountId)
    .is("disconnected_at", null)
    .single();
  if (error || !account) throw new Error("Connected Google account not found");
  if (!account.tasks_enabled) return { synced: 0, disabled: true };
  if (
    !String(account.scope ?? "")
      .split(/\s+/)
      .includes(googleTasksScope)
  )
    throw new Error(
      "Google Tasks permission is missing. Enable Google Tasks and finish authorization for this account.",
    );
  const worker = randomUUID(),
    args = { p_user_id: userId, p_account_id: accountId, p_worker_id: worker };
  // Share the existing account lease so manual sync and background workers cannot race.
  const lease = await db.rpc("acquire_gmail_lease", args);
  if (lease.error) throw lease.error;
  if (!lease.data) return { synced: 0, busy: true };
  let synced = 0;
  const errors: Array<{ localId: number; message: string }> = [];
  try {
    let token = await getGoogleAccessToken(userId, accountId);
    async function api<T>(
      path: string,
      method = "GET",
      body?: unknown,
    ): Promise<T> {
      let response = await fetch(
        `https://tasks.googleapis.com/tasks/v1/${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        },
      );
      if (response.status === 401) {
        token = await getGoogleAccessToken(userId, accountId, true);
        response = await fetch(
          `https://tasks.googleapis.com/tasks/v1/${path}`,
          {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000),
            cache: "no-store",
          },
        );
      }
      if (!response.ok)
        throw new Error(
          `Google Tasks HTTP ${response.status}. ${response.status === 403 ? "Enable Tasks API in Google Cloud and verify the Tasks scope." : "Retry or reconnect this account."}`,
        );
      return response.status === 204 ? (undefined as T) : await response.json();
    }
    let listId = account.google_tasklist_id as string | null;
    if (!listId) {
      let page: string | undefined;
      do {
        const lists = await api<{
          items?: Array<{ id: string; title: string }>;
          nextPageToken?: string;
        }>(
          `users/@me/lists?maxResults=100${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
        );
        listId = lists.items?.find((list) => list.title === "ASS")?.id ?? null;
        page = lists.nextPageToken;
      } while (!listId && page);
      if (!listId)
        listId = (
          await api<{ id: string }>("users/@me/lists", "POST", { title: "ASS" })
        ).id;
      const saved = await db
        .from("google_tokens")
        .update({ google_tasklist_id: listId })
        .eq("user_id", userId)
        .eq("id", accountId);
      if (saved.error) throw saved.error;
    }
    const remote: RemoteTask[] = [];
    let page: string | undefined;
    do {
      const batch = await api<{ items?: RemoteTask[]; nextPageToken?: string }>(
        `lists/${encodeURIComponent(listId!)}/tasks?maxResults=100&showCompleted=true&showHidden=true&showDeleted=true${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
      );
      remote.push(...(batch.items ?? []));
      page = batch.nextPageToken;
    } while (page);
    const rows = await db
      .from("todos")
      .select("*")
      .eq("user_id", userId)
      .order("local_id");
    if (rows.error) throw rows.error;
    for (const task of rows.data ?? []) {
      if (onlyLocalId !== undefined && task.local_id !== onlyLocalId) continue;
      if (task.google_account_id && task.google_account_id !== accountId)
        continue;
      const marker = `[ASS task ${task.local_id}]`;
      let mapped =
        remote.find((row) => row.id === task.google_task_id) ||
        remote.find((row) => row.notes?.includes(marker));
      try {
        if (task.deleted_at || task.status === "IGNORED") {
          if (mapped && !mapped.deleted)
            await api(
              `lists/${encodeURIComponent(listId!)}/tasks/${encodeURIComponent(mapped.id)}`,
              "DELETE",
            );
          continue;
        }
        if (mapped?.deleted) {
          const saved = await db
            .from("todos")
            .update({
              deleted_at: new Date().toISOString(),
              status: "IGNORED",
              google_synced_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("local_id", task.local_id);
          if (saved.error) throw saved.error;
          continue;
        }
        const localChanged =
          !task.google_synced_at ||
          Date.parse(task.updated_at) > Date.parse(task.google_synced_at);
        const remoteChanged =
          mapped?.updated &&
          task.google_synced_at &&
          Date.parse(mapped.updated) > Date.parse(task.google_synced_at);
        if (mapped && remoteChanged && !localChanged) {
          const saved = await db
            .from("todos")
            .update({
              title: mapped.title,
              description: (mapped.notes ?? "").replace(marker, "").trim(),
              due_date: mapped.due?.slice(0, 10) ?? null,
              done: mapped.status === "completed",
              google_task_id: mapped.id,
              google_tasklist_id: listId,
              google_account_id: accountId,
              google_synced_at: new Date().toISOString(),
              google_sync_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("local_id", task.local_id);
          if (saved.error) throw saved.error;
          synced++;
          continue;
        }
        if (mapped && remoteChanged && localChanged) {
          throw new Error(
            "Task changed in ASS and Google Tasks; review both versions before syncing.",
          );
        }
        if (!mapped && task.google_task_id)
          throw new Error(
            "Previously synced Google Task is unavailable; refusing to recreate a possibly deleted task.",
          );
        if (!mapped || localChanged) {
          const payload = {
            title: task.title,
            notes: `${String(task.description ?? "").slice(0, 7900)}\n${marker}`,
            due: task.due_date ? `${task.due_date}T00:00:00Z` : null,
            status: task.done ? "completed" : "needsAction",
            completed: task.done
              ? (task.completed_at ?? new Date().toISOString())
              : null,
          };
          mapped = await api<RemoteTask>(
            `lists/${encodeURIComponent(listId!)}/tasks${mapped ? `/${encodeURIComponent(mapped.id)}` : ""}`,
            mapped ? "PATCH" : "POST",
            payload,
          );
        }
        const saved = await db
          .from("todos")
          .update({
            google_task_id: mapped.id,
            google_tasklist_id: listId,
            google_account_id: accountId,
            google_synced_at: new Date().toISOString(),
            google_sync_error: null,
          })
          .eq("user_id", userId)
          .eq("local_id", task.local_id);
        if (saved.error) throw saved.error;
        synced++;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Tasks sync failed";
        errors.push({ localId: task.local_id, message });
        const saved = await db
          .from("todos")
          .update({ google_sync_error: message })
          .eq("user_id", userId)
          .eq("local_id", task.local_id);
        if (saved.error) throw saved.error;
      }
    }
    const stored = await db
      .from("google_tokens")
      .select("service_health")
      .eq("user_id", userId)
      .eq("id", accountId)
      .single();
    if (stored.error) throw stored.error;
    const now = new Date().toISOString();
    const savedHealth = await db
      .from("google_tokens")
      .update({
        service_health: {
          ...stored.data?.service_health,
          tasks: {
            state: errors.length ? "failed" : "connected",
            checkedAt: now,
            lastSuccessfulApiAt: now,
            error: errors[0]?.message ?? null,
          },
        },
      })
      .eq("user_id", userId)
      .eq("id", accountId);
    if (savedHealth.error) throw savedHealth.error;
    return { synced, errors };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google Tasks sync failed";
    const stored = await db
      .from("google_tokens")
      .select("service_health")
      .eq("user_id", userId)
      .eq("id", accountId)
      .single();
    if (!stored.error) {
      const saved = await db
        .from("google_tokens")
        .update({
          service_health: {
            ...stored.data?.service_health,
            tasks: {
              state: "failed",
              checkedAt: new Date().toISOString(),
              lastSuccessfulApiAt:
                stored.data?.service_health?.tasks?.lastSuccessfulApiAt ?? null,
              error: message,
            },
          },
        })
        .eq("user_id", userId)
        .eq("id", accountId);
      if (saved.error)
        console.error(
          JSON.stringify({
            service: "google-tasks",
            stage: "health-persistence-failed",
          }),
        );
    }
    throw error;
  } finally {
    const released = await db.rpc("release_gmail_lease", args);
    if (released.error) throw released.error;
  }
}
export async function verifyTasksScope(userId: string, accountId: string) {
  const account = await readStoredGoogleToken(userId, accountId);
  return Boolean(account?.scope?.split(/\s+/).includes(googleTasksScope));
}
export const syncTaskToGoogle = (
  userId: string,
  accountId: string,
  localId: number,
) => syncGoogleTasks(userId, accountId, localId);
