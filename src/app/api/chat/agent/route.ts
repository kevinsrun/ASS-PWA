import {NextRequest,NextResponse} from "next/server";
import {ApiAuthError,requireApiUser} from "@/lib/serverAuth";
import {runChatAgent} from "@/lib/chatAgent";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:NextRequest){
 try{
  const user=await requireApiUser(request),body=await request.json();
  if(typeof body.message!=="string"||!body.message.trim())throw new ApiAuthError("Enter a message",400);
  const encoder=new TextEncoder();let disconnected=false;
  const stream=new ReadableStream({async start(controller){
   const send=(item:unknown)=>{if(!disconnected)try{controller.enqueue(encoder.encode(JSON.stringify(item)+"\n"));}catch{disconnected=true;}};
   try{send({type:"progress",message:"Checking your request…"});const result=await runChatAgent(user.id,body,message=>send({type:"progress",message}),request.signal);send({type:"result",...result});}
   catch(error){send({type:"error",error:error instanceof Error?error.message:"ASS could not complete the request"});}
   finally{if(!disconnected)controller.close();}
  },cancel(){disconnected=true;}});
  return new Response(stream,{headers:{"Content-Type":"application/x-ndjson","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Agent unavailable"},{status:error instanceof ApiAuthError?error.status:500});}
}
