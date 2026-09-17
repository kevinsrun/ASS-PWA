import { getGoogleAccessToken, listGoogleAccounts } from "@/lib/googleAuth";

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; parents?: string[]; size?: string; webViewLink?: string };

async function driveJson<T>(userId: string, accountId: string, path: string): Promise<T> {
  const token = await getGoogleAccessToken(userId, accountId);
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store",signal:AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const body = await response.text().then((value) => value.slice(0, 1000));
    if (response.status === 403 && /insufficient authentication scopes|insufficientPermissions/i.test(body)) throw new Error("Google Drive permission is missing. Reconnect this Google account from Settings to grant Drive read access.");
    throw new Error(`Google Drive request failed: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

function escapedQuery(value: string) { return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'"); }

export async function searchDriveFiles(userId:string,accountId:string,query:string) {
  const q=encodeURIComponent(`trashed = false and (name contains '${escapedQuery(query)}' or fullText contains '${escapedQuery(query)}')`);
  return (await driveJson<{files:DriveFile[]}>(userId,accountId,`files?q=${q}&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,modifiedTime,webViewLink,parents)`)).files ?? [];
}

export async function listDriveFolder(userId: string, accountId: string, folderName = "Grow Up") {
  const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,parents,size,webViewLink),nextPageToken");
  const folderQuery = encodeURIComponent(`name = '${escapedQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const folders = await driveJson<{ files?: DriveFile[] }>(userId, accountId, `files?q=${folderQuery}&fields=${fields}&pageSize=20`);
  if (!folders.files?.length) return { folder: null, files: [] as DriveFile[] };
  const folder = folders.files[0];
  const childQuery = encodeURIComponent(`'${escapedQuery(folder.id)}' in parents and trashed = false`);
  const children = await driveJson<{ files?: DriveFile[] }>(userId, accountId, `files?q=${childQuery}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=100`);
  return { folder, files: (children.files ?? []).filter((file) => file.mimeType !== "application/vnd.google-apps.folder") };
}

export async function downloadDriveFile(userId: string, accountId: string, fileId: string) {
  const accounts = await listGoogleAccounts(userId);
  const account = accounts.find((row) => String(row.id) === accountId);
  if (!account) throw new Error("That Google account is not connected.");
  const token = await getGoogleAccessToken(userId, accountId);
  const metadata = await driveJson<DriveFile>(userId, accountId, `files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,parents,size,webViewLink`);
  const exports: Record<string, { mime: string; suffix: string }> = {
    "application/vnd.google-apps.document": { mime: "text/plain", suffix: ".txt" },
    "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", suffix: ".xlsx" },
    "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", suffix: ".pptx" },
  };
  const exportType = exports[metadata.mimeType];
  const endpoint = exportType
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportType.mime)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to download ${metadata.name}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 25 * 1024 * 1024) throw new Error("Selected Drive files must be 25 MB or smaller.");
  return { metadata, accountEmail: String(account.connected_email ?? "Google account"), name: exportType && !metadata.name.endsWith(exportType.suffix) ? `${metadata.name}${exportType.suffix}` : metadata.name, mimeType: exportType?.mime ?? metadata.mimeType, buffer };
}
