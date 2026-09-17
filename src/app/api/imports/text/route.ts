import {NextRequest,NextResponse} from "next/server";
import {ApiAuthError,requireApiUser} from "@/lib/serverAuth";
import {importTextSource} from "@/lib/sourceAnalysis";
import {classifyWritingSpans} from "@/lib/writingStyle";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:NextRequest){try{
 const user=await requireApiUser(request),body=await request.json();
 if(typeof body.content!=="string"||!body.content.trim()||body.content.length>250000)throw new ApiAuthError("Paste between 1 and 250,000 characters.",400);
 const sourceType=["pasted_text","manual_text","imessage"].includes(body.sourceType)?body.sourceType:"pasted_text";
 const result=await importTextSource(user.id,String(body.title ?? "Pasted text"),body.content,sourceType);
 if(sourceType==="imessage")await classifyWritingSpans(user.id,result.id!,body.content,"imessage_manual");
 return NextResponse.json(result,{status:201});
}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Text analysis failed"},{status:error instanceof ApiAuthError?error.status:500});}}
