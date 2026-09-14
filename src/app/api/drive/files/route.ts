import { NextRequest, NextResponse } from "next/server";
import { listDriveFolder } from "@/lib/googleDrive";
import { ingestDriveFile } from "@/lib/driveIngestion";
import { listGoogleAccounts } from "@/lib/googleAuth";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const accountId = request.nextUrl.searchParams.get("accountId");
    const folderName = request.nextUrl.searchParams.get("folder")?.trim() || "Grow Up";
    const accounts = await listGoogleAccounts(user.id);
    if (!accountId) return NextResponse.json({ accounts: accounts.map((row) => ({ id: row.id, email: row.connected_email, name: row.display_name })) });
    return NextResponse.json({ accounts: accounts.map((row) => ({ id: row.id, email: row.connected_email, name: row.display_name })), ...(await listDriveFolder(user.id, accountId, folderName)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive is unavailable.";
    return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { accountId?: string; fileId?: string };
    if (!body.accountId || !body.fileId) throw new ApiAuthError("Choose a connected account and Drive file.", 400);
    const result = await ingestDriveFile(user.id, body.accountId, body.fileId, true);
    if (result.alreadyImported) throw new ApiAuthError("This Drive file has already been imported.", 409);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive import failed.";
    console.error(JSON.stringify({ service: "drive-intelligence", stage: "failed", message }));
    return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}
