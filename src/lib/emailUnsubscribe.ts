import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { createHash } from "node:crypto";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import type { AutomationSettings } from "@/lib/automationSettings";
import { createAssistantAction } from "@/lib/objectCreation";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
export function publicUnsubscribeAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        /^[23][0-9a-f]{3}:/i.test(address) &&
        !blocked.check(address, "ipv6");
}
export function oneClickUnsubscribeTarget(
  headers: Record<string, string>,
  sender: string,
): URL | null {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  if (
    normalized["list-unsubscribe-post"]?.trim().toLowerCase() !==
    "list-unsubscribe=one-click"
  )
    return null;
  const urls = [
    ...String(normalized["list-unsubscribe"] ?? "").matchAll(
      /<(https:\/\/[^<>\s]+)>/gi,
    ),
  ];
  if (urls.length !== 1) return null;
  try {
    const url = new URL(urls[0][1]),
      domain = sender.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase();
    if (
      !domain ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      isIP(url.hostname) ||
      !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))
    )
      return null;
    // DKIM must bind both unsubscribe headers; provider-hosted preference pages
    // and unsigned unsubscribe links are deliberately review-only.
    const signature = normalized["dkim-signature"] ?? "";
    const signedHeaders =
      signature
        .match(/(?:^|;)\s*h=([^;]+)/i)?.[1]
        ?.replace(/\s/g, "")
        .toLowerCase()
        .split(":") ?? [];
    const signingDomain = signature
      .match(/(?:^|;)\s*d=([^;\s]+)/i)?.[1]
      ?.toLowerCase();
    const authentication = normalized["authentication-results"] ?? "";
    const authenticatedDomain = authentication
      .match(/\bdkim=pass\b[^;]*?\bheader\.(?:i|d)=@?([^\s;]+)/i)?.[1]
      ?.toLowerCase();
    if (
      signingDomain !== domain ||
      !signedHeaders.includes("list-unsubscribe") ||
      !signedHeaders.includes("list-unsubscribe-post") ||
      !/^mx\.google\.com\s*;/i.test(authentication.trim()) ||
      !/\bdkim=pass\b/i.test(authentication) ||
      authenticatedDomain !== domain
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
async function postOneClick(url: URL) {
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) => !publicUnsubscribeAddress(item.address))
  )
    throw new Error("Unsubscribe destination resolves to a non-public address");
  const destination = addresses[0];
  await new Promise<void>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        family: destination.family,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": 26,
        },
        lookup: (_host, _options, callback) =>
          callback(null, destination.address, destination.family),
      },
      (response) => {
        response.resume();
        if (
          response.statusCode &&
          response.statusCode >= 200 &&
          response.statusCode < 300
        )
          resolve();
        else
          reject(
            new Error(
              `Unsubscribe returned HTTP ${response.statusCode}; redirects are not followed`,
            ),
          );
      },
    );
    req.setTimeout(10_000, () =>
      req.destroy(
        new Error("Unsubscribe request timed out; outcome requires review"),
      ),
    );
    req.on("error", reject);
    req.end("List-Unsubscribe=One-Click");
  });
}
export async function unsubscribeObviousJunk(
  userId: string,
  accountId: string,
  settings: AutomationSettings,
) {
  if (!settings.unsubscribe_junk || settings.mode !== "aggressive") return;
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("A Supabase server key is not configured");
  const { data: messages, error } = await db
    .from("email_messages")
    .select("id,google_message_id,sender,raw_headers")
    .eq("user_id", userId)
    .eq("google_account_id", accountId)
    .eq("processing_status", "processed")
    .eq("disposition", "MARKETING")
    .eq("protected_sender", false)
    .gte("disposition_confidence", 0.99)
    .order("processed_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const { data: feedback, error: feedbackError } = await db
    .from("classification_feedback")
    .select("source_id,context_json")
    .eq("user_id", userId)
    .eq("source_type", "email")
    .in("user_action", ["ignore", "dismiss"])
    .order("created_at", { ascending: false })
    .limit(500);
  if (feedbackError) throw feedbackError;
  for (const message of messages ?? []) {
    const sender = String(message.sender ?? "");
    const headers = Object.fromEntries(
      Object.entries(message.raw_headers ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        String(value),
      ]),
    );
    const sourceId = `${accountId}:list:${createHash("sha256")
      .update(`${sender.toLowerCase()}:${headers["list-id"] ?? ""}`)
      .digest("hex")}`;
    const ignores = new Set(
      (feedback ?? [])
        .filter(
          (item) =>
            String(item.context_json?.sender ?? "").toLowerCase() ===
            sender.toLowerCase(),
        )
        .map((item) => item.source_id),
    );
    if (ignores.size < 3) continue;
    const target = oneClickUnsubscribeTarget(headers, sender);
    if (!target) {
      await createAssistantAction(userId, {
        sourceKind: "gmail",
        sourceId,
        actionType: "unsubscribe_review",
        title: `Review mailing list: ${sender}`,
        summary: `You explicitly ignored ${ignores.size} messages from this sender. No verified safe one-click endpoint is available; ASS has not unsubscribed you.`,
        payload: {
          googleAccountId: accountId,
          messageId: message.google_message_id,
          requiresReview: true,
        },
      });
      continue;
    }
    const { data: prior, error: priorError } = await db
      .from("automation_audit")
      .select("id,status")
      .eq("user_id", userId)
      .eq("source_id", sourceId)
      .eq("action", "email.unsubscribe")
      .maybeSingle();
    if (priorError) throw priorError;
    // Do not blindly replay uncertain external requests, including a worker
    // interruption after POST. Unlike removing a label, reversal isn't assured.
    if (prior) continue;
    const { data: audit, error: auditError } = await db
      .from("automation_audit")
      .insert({
        user_id: userId,
        source_id: sourceId,
        action: "email.unsubscribe",
        status: "pending",
        confidence: 0.99,
        reason: `Obvious retail marketing; ${ignores.size} distinct explicit ignores; aggressive unsubscribe authorized; DKIM-bound one-click header.`,
        reversible: false,
      })
      .select("id")
      .single();
    if (auditError) throw auditError;
    try {
      await postOneClick(target);
      const { error: doneError } = await db
        .from("automation_audit")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("user_id", userId)
        .eq("id", audit.id);
      if (doneError) throw doneError;
    } catch (failure) {
      const detail =
        failure instanceof Error ? failure.message : "Unsubscribe failed";
      const { error: storedError } = await db
        .from("automation_audit")
        .update({ status: "failed", error_message: detail })
        .eq("user_id", userId)
        .eq("id", audit.id);
      if (storedError) throw storedError;
      console.error(
        JSON.stringify({
          service: "email-unsubscribe",
          stage: "review-required",
          account: accountId.slice(0, 8),
          error: detail,
        }),
      );
    }
  }
}
