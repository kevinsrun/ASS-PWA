import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode, verifyGoogleOAuthState } from "@/lib/googleAuth";
import { syncGoogleCalendarForUser } from "@/lib/googleCalendarSync";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const stateValue = req.nextUrl.searchParams.get("state");

  if (error) {
    return NextResponse.redirect(
      new URL(`/profile?gmail=error&reason=${error}`, req.url)
    );
  }

  if (!code || !stateValue) {
    return NextResponse.redirect(new URL("/profile?gmail=missing-code", req.url));
  }

  try {
    const state = verifyGoogleOAuthState(stateValue);
    await exchangeGoogleCode(code, state.userId);
    const sync = await syncGoogleCalendarForUser(state.userId);
    if (sync.state !== "synced") {
      throw new Error(sync.error ?? "Initial Google Calendar sync failed");
    }
  } catch (tokenError) {
    console.error("Google OAuth callback failed:", tokenError);
    return NextResponse.redirect(new URL("/profile?gmail=token-error", req.url));
  }

  return NextResponse.redirect(new URL("/profile?gmail=connected", req.url));
}
