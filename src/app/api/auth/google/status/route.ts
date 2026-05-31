import { NextResponse } from "next/server";
import { isGmailConnected } from "@/lib/googleAuth";

export async function GET() {
  return NextResponse.json({
    connected: await isGmailConnected(),
    clientConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  });
}
