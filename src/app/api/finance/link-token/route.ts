import { NextRequest, NextResponse } from "next/server";
import { createPlaidLinkToken } from "@/lib/plaid";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json(await createPlaidLinkToken(user.id));
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start Plaid Link" }, { status });
  }
}
