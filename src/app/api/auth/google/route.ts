import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuthUrl } from "@/lib/googleAuth";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ url: getGoogleAuthUrl(user.id) });
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start Google authorization.";
    console.error("Google OAuth start failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
