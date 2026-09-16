import { NextRequest, NextResponse } from "next/server";
import { createPlaidLinkToken, plaidFailure } from "@/lib/plaid";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json(await createPlaidLinkToken(user.id));
  } catch (error) {
    const failure = plaidFailure(error);
    console.error(JSON.stringify({ service: "plaid-link", stage: "failed", ...failure }));
    const status = error instanceof ApiAuthError ? error.status : 500;
    return NextResponse.json({ error: failure.message, code: failure.code }, { status });
  }
}
