import { NextResponse } from "next/server";
import { getGoogleAuthUrl } from "@/lib/googleAuth";

export async function GET() {
  return NextResponse.redirect(getGoogleAuthUrl());
}
