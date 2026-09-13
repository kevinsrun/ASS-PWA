import { NextRequest, NextResponse } from "next/server";
import { exchangePlaidPublicToken } from "@/lib/plaid";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as {
      publicToken?: string;
      institution?: { institution_id?: string | null; name?: string | null };
    };
    if (!body.publicToken) throw new ApiAuthError("A Plaid public token is required", 400);
    return NextResponse.json(await exchangePlaidPublicToken(user.id, body.publicToken, body.institution));
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to connect financial account" }, { status });
  }
}
