import { NextResponse } from "next/server";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";

export async function GET() {
  return NextResponse.json(await scanRecentGmailSuggestions());
}
