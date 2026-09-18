import {NextRequest,NextResponse} from "next/server";
import {requireApiUser,ApiAuthError} from "@/lib/serverAuth";
import {getServiceSupabaseClient} from "@/lib/supabaseServer";
export const runtime="nodejs";
export async function GET(request:NextRequest){try{
 const user=await requireApiUser(request),db=getServiceSupabaseClient();if(!db)throw new Error("AI usage storage unavailable");
 const now=new Date(),from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())).toISOString();
 const counts:Record<string,number>={};let confidenceSum=0,confidenceCount=0;
 for(let offset=0;;offset+=500){const result=await db.from("ai_usage_events").select("event_type,confidence").eq("user_id",user.id).in("task_type",["document_analysis","email_triage"]).gte("created_at",from).lte("created_at",now.toISOString()).order("created_at").order("id").range(offset,offset+499);if(result.error)throw result.error;for(const row of result.data??[]){counts[row.event_type]=(counts[row.event_type]??0)+1;if(row.event_type==="local_accepted"&&typeof row.confidence==="number"){confidenceSum+=row.confidence;confidenceCount++;}}if((result.data??[]).length<500)break;}
 return NextResponse.json({from,through:now.toISOString(),counts,averageAcceptedConfidence:confidenceCount?confidenceSum/confidenceCount:null,coverage:"Document analyses and Gmail classification; chat/agent calls outside these scopes are not yet counted. Cache hits count reused analyses, not token/cost savings.",fallbackRate:counts.gemini_request?(counts.gemini_fallback??0)/counts.gemini_request:null},{headers:{"Cache-Control":"no-store"}});
}catch(error){return NextResponse.json({error:error instanceof ApiAuthError?error.message:"AI usage unavailable"},{status:error instanceof ApiAuthError?error.status:500});}}
