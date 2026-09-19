export const gmailRetryDelaysMs=[60_000,300_000,900_000,3_600_000,14_400_000] as const;
export type GmailFailure={retryable:boolean;auth:boolean;provider:"gemini"|"gmail"|"unknown";status:number|null;reason:string};

export function gmailMaxAttempts(){
 const configured=Number.parseInt(process.env.GMAIL_MAX_ATTEMPTS||"5",10);
 return Number.isFinite(configured)&&configured>0?Math.min(configured,20):5;
}

export function classifyGmailFailure(value:unknown):GmailFailure{
 const raw=value instanceof Error?value.message:String(value??"Unknown Gmail processing failure");
 const reason=raw.replace(/(?:Bearer|token|key)\s+[A-Za-z0-9._~+\/-]+/gi,"[credential redacted]").slice(0,2000);
 const status=Number(reason.match(/(?:HTTP|status:?|\[)(?:\s*)(401|403|429|500|502|503|504)\b/i)?.[1]??NaN);
 const auth=status===401||status===403||/invalid_grant|revoked|refresh token|missing (?:gmail )?scope|insufficient.*scope/i.test(reason);
 const retryable=!auth&&([429,500,502,503,504].includes(status)||/timeout|timed out|network|fetch failed|socket|ECONNRESET|provider unavailable|invalid or incomplete|invalid.*json/i.test(reason));
 const provider=/GoogleGenerativeAI|generativelanguage|Gemini/i.test(reason)?"gemini":/Gmail returned|gmail\.googleapis/i.test(reason)?"gmail":"unknown";
 return {retryable,auth,provider,status:Number.isFinite(status)?status:null,reason};
}
export function gmailRetryDecision(attempt:number,failure:GmailFailure,now=Date.now()){
 if(failure.auth)return {status:"failed" as const,nextAttemptAt:null};
 if(attempt>=gmailMaxAttempts())return {status:"dead_letter" as const,nextAttemptAt:null};
 return {status:"retry_wait" as const,nextAttemptAt:new Date(now+gmailRetryDelaysMs[Math.max(0,attempt-1)]).toISOString()};
}
