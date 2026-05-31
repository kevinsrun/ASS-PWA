import { NextRequest, NextResponse } from "next/server";

export function verifyCronRequest(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return null;
  }

  const authorization = req.headers.get("authorization");
  if (authorization === `Bearer ${secret}`) {
    return null;
  }

  return NextResponse.json(
    { error: "Unauthorized cron request" },
    { status: 401 }
  );
}
