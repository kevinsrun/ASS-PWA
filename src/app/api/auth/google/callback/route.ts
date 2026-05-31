import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode } from "@/lib/googleAuth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/profile?gmail=error&reason=${error}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/profile?gmail=missing-code", req.url));
  }

  try {
    await exchangeGoogleCode(code);
  } catch (tokenError) {
    console.error("Google OAuth callback failed:", tokenError);
    return NextResponse.redirect(new URL("/profile?gmail=token-error", req.url));
  }

  return NextResponse.redirect(new URL("/profile?gmail=connected", req.url));
}
