export const emailDispositions = [
  "IMPORTANT",
  "ACTION_REQUIRED",
  "RESPONSE_REQUIRED",
  "EVENT",
  "DEADLINE",
  "REFERENCE",
  "LOW_PRIORITY",
  "NEWSLETTER",
  "MARKETING",
  "JUNK",
  "SPAM_LIKE",
] as const;
export type EmailDisposition = (typeof emailDispositions)[number];
export type DispositionInput = {
  sender: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  type: string;
  importance: string;
  actionRequired: boolean;
  responseNeeded: boolean;
};
export function emailDisposition(
  input: DispositionInput,
  mode: "aggressive" | "balanced" | "manual",
) {
  const text = `${input.subject}\n${input.text}`;
  const headers = Object.fromEntries(
    Object.entries(input.headers).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
  const domain =
    input.sender.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase() ?? "";
  // Protect institutional and consequential correspondence, even when sent by
  // a bulk provider. Never let a marketing score overrule these constraints.
  const protectedSender =
    !domain ||
    /(?:^|\.)(?:edu|ac\.uk)$/.test(domain) ||
    /\b(?:professor|advisor|financial aid|research|recruit(?:er|ing)|interview|application|admission|course|syllabus|security|verification|password|authentication|invoice|payment|bank|scholarship|grant|fellowship)\b/i.test(
      text,
    );
  const bulk = Boolean(headers["list-id"] || headers["list-unsubscribe"]);
  const marketing =
    bulk &&
    /\b(?:shop now|buy now|sale ends|limited.time sale|discount code|promo code|percent off|\d+% off|clearance|exclusive deals|shopping|free shipping)\b/i.test(
      text,
    );
  let disposition: EmailDisposition;
  let reason: string;
  if (marketing && !protectedSender) {
    disposition = "MARKETING";
    reason =
      "Retail promotion with mailing-list headers; no protected correspondence detected.";
  } else if (input.responseNeeded) {
    disposition = "RESPONSE_REQUIRED";
    reason = "A personal reply request was detected.";
  } else if (input.type === "deadline" && input.actionRequired) {
    disposition = "DEADLINE";
    reason = "An actionable deadline was detected.";
  } else if (input.actionRequired) {
    disposition = "ACTION_REQUIRED";
    reason = "The message contains an action requiring attention.";
  } else if (
    ["meeting", "club_event", "interview", "travel"].includes(input.type)
  ) {
    disposition = "EVENT";
    reason = "An event or invitation was detected.";
  } else if (
    protectedSender ||
    ["high", "urgent"].includes(input.importance) ||
    ["research", "scholarship", "financial_aid"].includes(input.type)
  ) {
    disposition = "IMPORTANT";
    reason = "Protected or potentially high-value information is retained.";
  } else if (
    bulk &&
    /\b(?:newsletter|weekly digest|daily digest|weekly update)\b/i.test(text)
  ) {
    disposition = "NEWSLETTER";
    reason = "Generic mailing-list digest without a verified action.";
  } else {
    disposition = input.type === "no_action" ? "LOW_PRIORITY" : "REFERENCE";
    reason = "No verified urgent action or personal response is required.";
  }
  const suppressed =
    !protectedSender &&
    (disposition === "MARKETING" ||
      (mode === "aggressive" &&
        ["NEWSLETTER", "LOW_PRIORITY"].includes(disposition)));
  return {
    disposition,
    reason,
    protectedSender,
    suppressed,
    confidence: disposition === "MARKETING" ? 0.99 : 0.9,
  };
}
