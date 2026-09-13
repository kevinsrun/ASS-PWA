import { createHash, timingSafeEqual } from "crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { refreshFinanceAlerts } from "@/lib/finance";
import { getPlaidClient, syncPlaidItem } from "@/lib/plaid";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

async function verifyPlaidWebhook(rawBody: string, signature: string | null) {
  if (!signature) return false;
  const header = decodeProtectedHeader(signature);
  if (header.alg !== "ES256" || !header.kid) return false;
  const response = await getPlaidClient().webhookVerificationKeyGet({ key_id: header.kid });
  const key = await importJWK(response.data.key as JWK, "ES256");
  await jwtVerify(signature, key, { algorithms: ["ES256"], maxTokenAge: "5 min" });
  const payload = decodeJwt(signature);
  const claimed = String(payload.request_body_sha256 ?? "");
  const actual = createHash("sha256").update(rawBody).digest("hex");
  const left = Buffer.from(claimed);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    if (!(await verifyPlaidWebhook(rawBody, request.headers.get("plaid-verification")))) {
      return NextResponse.json({ error: "Invalid Plaid webhook signature" }, { status: 401 });
    }
    const body = JSON.parse(rawBody) as { webhook_type?: string; webhook_code?: string; item_id?: string; error?: { error_code?: string; error_message?: string } };
    if (!body.item_id) return NextResponse.json({ ok: true });
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const { data: item, error } = await supabase.from("plaid_items").select("id,user_id").eq("item_id", body.item_id).maybeSingle();
    if (error) throw error;
    if (!item) return NextResponse.json({ ok: true });
    if (body.webhook_type === "TRANSACTIONS" && body.webhook_code === "SYNC_UPDATES_AVAILABLE") {
      after(async () => {
        try {
          await syncPlaidItem(String(item.user_id), String(item.id));
          await refreshFinanceAlerts(String(item.user_id));
        } catch (syncError) {
          console.error(JSON.stringify({ service: "plaid-webhook", stage: "sync_failed", message: syncError instanceof Error ? syncError.message : "Unknown error" }));
        }
      });
    }
    if (body.webhook_type === "ITEM" && body.webhook_code === "ERROR") {
      await supabase.from("plaid_items").update({
        status: "error",
        error_code: body.error?.error_code ?? null,
        error_message: body.error?.error_message ?? "Plaid connection needs attention",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(JSON.stringify({ service: "plaid-webhook", stage: "failed", message: error instanceof Error ? error.message : "Unknown webhook error" }));
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
