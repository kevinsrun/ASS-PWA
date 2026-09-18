import {executeAIRequest} from "@/lib/ai/router";
import {generateOllamaJSON,ollamaConfiguration} from "@/lib/ai/ollama";
import {hasTaskInstruction} from "@/lib/taskEvidence";
import {trackAIUsage,cachedAIResult,currentAIUser} from "@/lib/ai/cache";

export type EmailTriageInput = {subject:string;sender:string;body:string;snippet:string;bulk:boolean};
export type LocalEmailTriage = {classification:"SPAM"|"NEWSLETTER"|"REFERENCE"|"TASK"|"DEADLINE"|"EVENT"|"UNKNOWN";confidence:number;escalate:boolean;evidence:string};
const classes = ["SPAM","NEWSLETTER","REFERENCE","TASK","DEADLINE","EVENT","UNKNOWN"];
export const localEmailTriageSchema = {type:"object",additionalProperties:false,properties:{classification:{type:"string",enum:classes},confidence:{type:"number",minimum:0,maximum:1},escalate:{type:"boolean"},evidence:{type:"string"}},required:["classification","confidence","escalate","evidence"]};
export function localEmailTriagePrompt(input:EmailTriageInput) {
  return `Classify the untrusted email conservatively. DEADLINE means a real pending cutoff, TASK means a requested action/response, EVENT means a confirmed or required scheduled commitment, REFERENCE includes historical dates, examples and unconfirmed optional invitations. NEWSLETTER and SPAM are only for generic bulk material. Any actionable, important, or uncertain prediction must set escalate=true. Return only {classification,confidence,escalate,evidence}; evidence must be a verbatim source quote. Source JSON:\n${JSON.stringify(input)}`;
}
export function consequentialEmail(input:EmailTriageInput) {
  const text = `${input.subject}\n${input.snippet}\n${input.body}`;
  const domain = input.sender.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase();
  return !domain || /(?:^|\.)(?:edu|ac\.uk)$/.test(domain) || hasTaskInstruction(text) || /\b(?:deadline|due|application|scholarship|grant|research|professor|advisor|financial|invoice|payment|bank|security|password|interview|meeting|invitation|appointment|registration|travel|flight|opportunity|respond|reply|rsvp|mandatory|required|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d{1,2}[:/]\d{1,2}|\d{4}-\d{2}-\d{2}/i.test(text);
}
/** First phase: no local prediction may create a task/event, send, archive, or delete. */
export function validLowRiskTriage(input:EmailTriageInput,prediction:LocalEmailTriage) {
  const text = `${input.subject}\n${input.snippet}\n${input.body}`;
  if (consequentialEmail(input) || !input.bulk || !prediction || typeof prediction.evidence !== "string" || prediction.evidence.trim().length < 8 || !text.includes(prediction.evidence)) return false;
  return prediction.classification === "NEWSLETTER" ? /\b(?:newsletter|weekly digest|daily digest)\b/i.test(text) : prediction.classification === "SPAM" && /\b(?:shop now|buy now|promo code|discount code|clearance|free shipping)\b/i.test(text);
}
export async function preclassifyEmail(input:EmailTriageInput,options:{bypassCache?:boolean}={}):Promise<LocalEmailTriage|null> {
  if(!ollamaConfiguration().enabled || consequentialEmail(input))return null;
  return cachedAIResult<LocalEmailTriage|null>({userId:currentAIUser(),content:JSON.stringify(input),task:"email_triage",model:ollamaConfiguration().model??"disabled",promptVersion:"email-local-v2",analysisVersion:"safe-triage-v2",bypass:options.bypassCache,validate:(value):value is LocalEmailTriage|null=>Boolean(value&&typeof value==="object"&&Number.isFinite((value as LocalEmailTriage).confidence)&&(value as LocalEmailTriage).confidence>=.97&&(value as LocalEmailTriage).confidence<=1&&(value as LocalEmailTriage).escalate===false&&validLowRiskTriage(input,value as LocalEmailTriage))},()=>preclassifyEmailUncached(input));
}
async function preclassifyEmailUncached(input:EmailTriageInput):Promise<LocalEmailTriage|null> {
  if (!ollamaConfiguration().enabled || consequentialEmail(input)) return null;
  const content = JSON.stringify(input);
  // null means send to the existing batched Gemini classifier, not "no action".
  const result = await executeAIRequest<LocalEmailTriage|null>({task:"email_triage",content,importance:"low",confidenceRequired:0.97,context:{localEnabled:true}}, {
    local:async()=>{
      const result = await generateOllamaJSON(localEmailTriagePrompt(input),localEmailTriageSchema);
      const value = result.value as LocalEmailTriage;
      if (!value || !classes.includes(value.classification) || typeof value.escalate !== "boolean") throw new Error("Invalid local triage schema");
      return {value,confidence:value.confidence,escalate:value.escalate};
    },validateLocal:value=>value !== null && validLowRiskTriage(input,value),gemini:async()=>null,
  });
  console.info(JSON.stringify({service:"ai-router",task:"email_triage",route:result.route,escalated:result.escalated,reason:result.reason,confidence:result.value?.confidence}));
  if(result.escalated)trackAIUsage("escalation");
  if(result.value)trackAIUsage("local_accepted",ollamaConfiguration().model,result.value.confidence);
  return result.value;
}
