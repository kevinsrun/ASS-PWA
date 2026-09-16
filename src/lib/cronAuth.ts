import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";

export function validCronAuthorization(authorization: string | null, secret: string | undefined) {
  if (!secret || !authorization) return false;
  return timingSafeEqual(createHash("sha256").update(authorization).digest(), createHash("sha256").update(`Bearer ${secret}`).digest());
}

export function verifyCronRequest(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 401 }
    );
  }

  const authorization = req.headers.get("authorization");
  if (validCronAuthorization(authorization, secret)) {
    return null;
  }

  return NextResponse.json(
    { error: "Unauthorized cron request" },
    { status: 401 }
  );
}
