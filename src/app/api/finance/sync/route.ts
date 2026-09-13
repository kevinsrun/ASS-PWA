import { NextRequest, NextResponse } from "next/server";
import { refreshFinanceAlerts } from "@/lib/finance";
import { syncPlaidForUser } from "@/lib/plaid";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const results = await syncPlaidForUser(user.id);
    await refreshFinanceAlerts(user.id);
    return NextResponse.json({ ok: true, items: results.length, results });
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to synchronize finances" }, { status });
  }
}
