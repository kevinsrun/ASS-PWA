import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { runIntelligenceSync } from "@/lib/intelligenceOrchestrator";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const result = await runIntelligenceSync("manual", { userId: user.id, triggerSource: "settings" });
    return NextResponse.json(result, { status: result.status === "partial" ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}
