import { after, NextRequest, NextResponse } from "next/server";
import { decodeGmailPush, gmailPushConfiguration, persistGmailPush, processGmailPushQueue, validateGmailPush } from "@/lib/gmailPush";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  if (!gmailPushConfiguration().ready) return NextResponse.json({ error: "Gmail push configuration is incomplete" }, { status: 503 });
  try { await validateGmailPush(request.headers.get("authorization")); }
  catch { return NextResponse.json({ error: "Invalid Pub/Sub identity" }, { status: 401 }); }
  let notification;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    notification = decodeGmailPush(JSON.parse(raw));
  } catch (error) {
    console.error(JSON.stringify({service:"gmail-push",stage:"payload-rejected",message:error instanceof Error ? error.message : "Invalid Gmail notification"}));
    return NextResponse.json({ error: "Invalid Gmail notification" }, { status: 400 });
  }
  try {
    const accounts = await persistGmailPush(notification);
    after(async () => {
      try { await processGmailPushQueue(2); }
      catch (error) { console.error(JSON.stringify({ service: "gmail-push", stage: "worker-failed", message: error instanceof Error ? error.message : "Queue worker failed" })); }
    });
    console.info(JSON.stringify({ service: "gmail-push", stage: "persisted", notificationId: notification.notificationId, historyId: notification.historyId, accounts }));
    return NextResponse.json({ accepted: true });
  } catch (error) {
    console.error(JSON.stringify({ service: "gmail-push", stage: "persistence-failed", message: error instanceof Error ? error.message : "Persistence failed" }));
    return NextResponse.json({ error: "Notification could not be persisted; retry required" }, { status: 503 });
  }
}
