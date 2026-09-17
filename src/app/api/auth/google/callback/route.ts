import { after, NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode, verifyGoogleOAuthState } from "@/lib/googleAuth";
import { syncGoogleCalendarForUser } from "@/lib/googleCalendarSync";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";
import { verifyGoogleServices } from "@/lib/googleServiceHealth";
import { renewGmailWatches } from "@/lib/gmailPush";

export async function GET(req: NextRequest) {
  let serviceAttention = false;
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
    const connection = await exchangeGoogleCode(code, state.userId);
    const [health] = await verifyGoogleServices(state.userId, connection.accountId, true);
    const sync = await syncGoogleCalendarForUser(
      state.userId,
      undefined,
      connection.accountId
    );
    // OAuth and each service are separate outcomes; one denied service must not
    // mask the others or pretend the whole account is healthy.
    serviceAttention = sync.state !== "synced" || [health.gmail, health.drive, health.calendar].some(service => service.state !== "connected");
    // Email intelligence is useful immediately, but a Gemini/Gmail failure
    // must not undo an otherwise valid OAuth connection.
    after(async () => {
      try {
        await renewGmailWatches(state.userId,connection.accountId);
        await scanRecentGmailSuggestions(state.userId, connection.accountId);
      } catch (scanError) {
        console.error("Initial Gmail intelligence scan failed:", scanError);
      }
    });
  } catch (tokenError) {
    console.error("Google OAuth callback failed:", tokenError);
    return NextResponse.redirect(new URL("/profile?gmail=token-error", req.url));
  }

  return NextResponse.redirect(new URL(`/profile?gmail=${serviceAttention ? "service-attention" : "connected"}`, req.url));
}
