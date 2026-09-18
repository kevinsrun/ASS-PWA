export type AIRoute = "DETERMINISTIC" | "LOCAL_GEMMA" | "GEMINI_LOW" | "GEMINI_MEDIUM" | "GEMINI_HIGH";
export type AIRequest = {
  task: string;
  content: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ambiguity?: number;
  confidenceRequired?: number;
  context?: {
    privacy?: "standard" | "local_only";
    toolUseRequired?: boolean;
    localEnabled?: boolean;
    geminiAvailable?: boolean;
    localConfidence?: number;
    localEscalate?: boolean;
  };
};
const deterministic = new Set(["calendar_overlap", "timezone_normalization", "duplicate_id", "deadline_proximity", "permissions", "cache_lookup", "api_validation", "string_normalization"]);
const local = new Set(["email_triage", "spam_classification", "newsletter_detection", "document_type", "reference_detection", "priority_preclassification", "response_preclassification", "task_preclassification", "deadline_preclassification", "calendar_preclassification", "document_summary"]);

/** Policy only: deterministic work is executed by existing domain services, not a model. */
export function routeAIRequest(request: AIRequest): {route: AIRoute; reason: string; blocked: boolean} {
  const context = request.context ?? {};
  if (deterministic.has(request.task)) return {route:"DETERMINISTIC",reason:"Exact calculation or validation belongs to code",blocked:false};
  const important = request.importance === "high" || request.importance === "urgent";
  const uncertain = (request.ambiguity ?? 0) >= 0.5 || context.localEscalate === true || (context.localConfidence !== undefined && context.localConfidence < (request.confidenceRequired ?? 0.95));
  const eligible = local.has(request.task) && !important && !uncertain && !context.toolUseRequired && request.content.length <= 12000;
  if (eligible && context.localEnabled) return {route:"LOCAL_GEMMA",reason:"Bounded low-risk preclassification",blocked:false};
  if (context.privacy === "local_only") return {route:"LOCAL_GEMMA",reason:"Cloud inference forbidden by request privacy policy",blocked:!eligible || !context.localEnabled};
  const route: AIRoute = important || uncertain || context.toolUseRequired ? "GEMINI_HIGH" : local.has(request.task) ? "GEMINI_LOW" : "GEMINI_MEDIUM";
  return {route,reason:context.geminiAvailable === false ? "Gemini unavailable; preserve work for retry, never downgrade consequential reasoning" : "Reasoning, escalation, or local provider unavailable",blocked:context.geminiAvailable === false};
}

export async function executeAIRequest<T>(request: AIRequest, providers: {
  deterministic?: () => Promise<T>;
  local: () => Promise<{value:T; confidence:number; escalate:boolean}>;
  gemini: (route: AIRoute) => Promise<T>;
  validateLocal: (value:T) => boolean;
}): Promise<{value:T; route:AIRoute; escalated:boolean; reason:string}> {
  const decision = routeAIRequest(request);
  if (decision.blocked) throw new Error(decision.reason);
  if (decision.route === "DETERMINISTIC") {
    if (!providers.deterministic) throw new Error("A deterministic resolver is required; model fallback is forbidden");
    return {value:await providers.deterministic(),route:decision.route,escalated:false,reason:decision.reason};
  }
  if (decision.route !== "LOCAL_GEMMA") return {value:await providers.gemini(decision.route),route:decision.route,escalated:false,reason:decision.reason};
  let reason = "Local confidence or deterministic validation requires escalation";
  try {
    const result = await providers.local();
    if (Number.isFinite(result.confidence) && result.confidence <= 1 && result.confidence >= (request.confidenceRequired ?? 0.95) && !result.escalate && providers.validateLocal(result.value)) {
      return {value:result.value,route:"LOCAL_GEMMA",escalated:false,reason:decision.reason};
    }
  } catch {
    reason = "Local provider failed; use existing Gemini pipeline";
  }
  if (request.context?.privacy === "local_only") throw new Error("Local analysis needs review; cloud fallback forbidden by privacy policy");
  if (request.context?.geminiAvailable === false) throw new Error("Local analysis requires escalation but Gemini is unavailable; retain for retry");
  return {value:await providers.gemini("GEMINI_HIGH"),route:"GEMINI_HIGH",escalated:true,reason};
}
