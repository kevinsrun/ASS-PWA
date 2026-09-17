import {NextRequest,NextResponse} from "next/server";
import {reanalyzeSource} from "@/lib/documentReanalysis";
import {ApiAuthError,requireApiUser} from "@/lib/serverAuth";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:NextRequest){
 try{const user=await requireApiUser(request);return NextResponse.json(await reanalyzeSource(user.id,await request.json()));}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Re-analysis failed"},{status:error instanceof ApiAuthError?error.status:500});}
}
