import { randomUUID } from "crypto";
import { createAssistantAction } from "@/lib/objectCreation";
import { getGoogleAccessToken, listGoogleAccounts } from "@/lib/googleAuth";
import { listDriveFolder, type DriveFile } from "@/lib/googleDrive";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { ingestDriveFile } from "@/lib/driveIngestion";

type ChangePage = {
  changes?: Array<{ fileId: string; removed?: boolean; file?: DriveFile & { trashed?: boolean } }>;
  nextPageToken?: string;
  newStartPageToken?: string;
};

async function driveFetch<T>(token: string, path: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 403 && /insufficient authentication scopes|insufficientPermissions/i.test(body)) {
      throw new Error("Google Drive permission is missing. Reconnect this Google account from Settings to grant Drive read access.");
    }
    throw new Error(`Google Drive returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

async function startToken(token: string) {
  return (await driveFetch<{ startPageToken: string }>(token, "changes/startPageToken?supportsAllDrives=true")).startPageToken;
}

export async function syncGoogleDriveForUser(userId: string, onlyAccountId?: string) {
  const runId = randomUUID();
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const accounts = (await listGoogleAccounts(userId)).filter((account) => !onlyAccountId || String(account.id) === onlyAccountId);
  let filesScanned = 0;
  let actionItemsCreated = 0;
  const failures: string[] = [];

  for (const account of accounts) {
    const accountId = String(account.id);
    const now = new Date().toISOString();
    try {
      await supabase.from("drive_sync_state").upsert({ user_id: userId, google_account_id: accountId, sync_status: "syncing", last_sync_error: null, updated_at: now }, { onConflict: "user_id,google_account_id" });
      const token = await getGoogleAccessToken(userId, accountId);
      const { data: state, error: stateReadError } = await supabase.from("drive_sync_state").select("change_token,watched_folder_ids").eq("user_id", userId).eq("google_account_id", accountId).single();
      if (stateReadError) throw stateReadError;
      let watchedFolderIds = Array.isArray(state.watched_folder_ids) ? state.watched_folder_ids.map(String) : [];
      let files: DriveFile[] = [];
      let nextToken = state.change_token ? String(state.change_token) : null;

      if (!nextToken || watchedFolderIds.length === 0) {
        const initial = await listDriveFolder(userId, accountId, "Grow Up");
        watchedFolderIds = initial.folder ? [initial.folder.id] : [];
        files = initial.files;
        nextToken = await startToken(token);
      } else {
        let pageToken: string | undefined = nextToken;
        try {
          do {
            const fields = encodeURIComponent("nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,parents,size,webViewLink,trashed))");
            const page: ChangePage = await driveFetch<ChangePage>(token, `changes?pageToken=${encodeURIComponent(pageToken)}&spaces=drive&includeRemoved=true&supportsAllDrives=true&fields=${fields}`);
            for (const change of page.changes ?? []) {
              if (!change.removed && change.file && !change.file.trashed && change.file.parents?.some((id: string) => watchedFolderIds.includes(id))) files.push(change.file);
            }
            pageToken = page.nextPageToken;
            if (page.newStartPageToken) nextToken = page.newStartPageToken;
          } while (pageToken);
        } catch (error) {
          if (!String(error).includes("HTTP 410")) throw error;
          console.warn(JSON.stringify({ service: "drive-sync", runId, account: accountId.slice(0, 8), stage: "change-token-expired" }));
          const initial = await listDriveFolder(userId, accountId, "Grow Up");
          watchedFolderIds = initial.folder ? [initial.folder.id] : [];
          files = initial.files;
          nextToken = await startToken(token);
        }
      }

      for (const [index, file] of files.entries()) {
        const { data: saved, error } = await supabase.from("google_drive_files").upsert({
          user_id: userId, google_account_id: accountId, drive_file_id: file.id,
          parent_drive_file_id: file.parents?.[0] ?? null, name: file.name,
          mime_type: file.mimeType, modified_at: file.modifiedTime ?? null,
          updated_at: now,
        }, { onConflict: "user_id,google_account_id,drive_file_id" }).select("imported_source_id").single();
        if (error) throw error;
        if (!saved.imported_source_id) {
          let action;
          if (index < 2) {
            try {
              const imported = await ingestDriveFile(userId, accountId, file.id);
              if (imported.pendingCount > 0) action = await createAssistantAction(userId, {
                sourceKind: "drive", sourceId: `${accountId}:${file.id}`, actionType: "review_extraction",
                title: `Review ${file.name}`, summary: `${imported.pendingCount} extracted items need a decision.`,
                payload: { importedSourceId: imported.id, googleAccountId: accountId, driveFileId: file.id },
              });
            } catch (error) {
              action = await createAssistantAction(userId, { sourceKind: "drive", sourceId: `${accountId}:${file.id}`, actionType: "import_failed", title: `${file.name} could not be analyzed`, summary: error instanceof Error ? error.message : "Drive analysis failed.", priority: "high", status: "failed", errorMessage: error instanceof Error ? error.message : "Drive analysis failed.", payload: { googleAccountId: accountId, driveFileId: file.id } });
            }
          } else action = await createAssistantAction(userId, {
            sourceKind: "drive", sourceId: `${accountId}:${file.id}`, actionType: "import_file",
            title: `Review ${file.name}`, summary: "A new or changed file was found in Grow Up.",
            payload: { googleAccountId: accountId, driveFileId: file.id, mimeType: file.mimeType, webViewLink: file.webViewLink ?? null },
          });
          if (action?.created) actionItemsCreated += 1;
        }
      }
      filesScanned += files.length;
      const { error: stateWriteError } = await supabase.from("drive_sync_state").update({
        change_token: nextToken, watched_folder_ids: watchedFolderIds, sync_status: "synced",
        last_successful_sync_at: now, last_sync_error: null, last_files_scanned: files.length, updated_at: now,
      }).eq("user_id", userId).eq("google_account_id", accountId);
      if (stateWriteError) throw stateWriteError;
      console.info(JSON.stringify({ service: "drive-sync", runId, account: accountId.slice(0, 8), stage: "completed", filesScanned: files.length, watchedFolders: watchedFolderIds.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Drive sync failure";
      failures.push(`${accountId.slice(0, 8)}: ${message}`);
      await supabase.from("drive_sync_state").upsert({ user_id: userId, google_account_id: accountId, sync_status: "error", last_sync_error: message, updated_at: new Date().toISOString() }, { onConflict: "user_id,google_account_id" });
      console.error(JSON.stringify({ service: "drive-sync", runId, account: accountId.slice(0, 8), stage: "failed", message }));
    }
  }
  return { accounts: accounts.length, filesScanned, actionItemsCreated, failures };
}
