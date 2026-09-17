import {NextRequest,NextResponse} from "next/server";
import {verifyCronRequest} from "@/lib/cronAuth";
import {renewGmailWatches,processGmailPushQueue} from "@/lib/gmailPush";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:NextRequest) {
  const unauthorized=verifyCronRequest(request);if(unauthorized) return unauthorized;
  try {
    const watches=await renewGmailWatches();
    const results=await processGmailPushQueue(2);
    const failures=[...watches.errors,...results.flatMap(result=>result.failures)];
    return NextResponse.json({ok:watches.configured&&!failures.length,watches,processedAccounts:results.length,errors:failures},{status:!watches.configured ? 503 : failures.length ? 207 : 200});
  }catch(error) {return NextResponse.json({error:error instanceof Error ? error.message : "Gmail maintenance failed"},{status:500});}
}
