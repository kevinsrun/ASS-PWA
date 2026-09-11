import { NextRequest, NextResponse } from "next/server";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json(await scanRecentGmailSuggestions(user.id));
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Gmail scan failed.";
    console.error("Gmail import failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
