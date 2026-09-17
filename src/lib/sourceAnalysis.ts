import {createHash} from "crypto";
import {reanalyzeSource} from "@/lib/documentReanalysis";
import {getServiceSupabaseClient} from "@/lib/supabaseServer";
export async function analyzeSource(userId:string,sourceId:string){
 const db=getServiceSupabaseClient();if(!db)throw new Error("ASS Cloud is not configured");
 const {data:source,error}=await db.from("imported_sources").select("source_type").eq("id",sourceId).eq("user_id",userId).single();if(error||!source)throw new Error("Imported source not found");
 if(source.source_type==="file"){const {data:file,error}=await db.from("imported_files").select("id").eq("imported_source_id",sourceId).eq("user_id",userId).single();if(error||!file)throw new Error("Original file not found");return reanalyzeSource(userId,{fileId:file.id});}
 return reanalyzeSource(userId,{sourceId});
}
export async function importTextSource(userId:string,title:string,content:string,sourceType="pasted_text"){
 const db=getServiceSupabaseClient();if(!db)throw new Error("ASS Cloud is not configured");
 if(!content.trim()||content.length>250000)throw new Error("Paste between 1 and 250,000 characters.");
 const externalId=createHash("sha256").update(`${sourceType}:${content}`).digest("hex");
 const {data:existing,error:lookupError}=await db.from("imported_sources").select("id").eq("user_id",userId).eq("source_type",sourceType).eq("external_id",externalId).maybeSingle();if(lookupError)throw lookupError;
 let sourceId=existing?.id as string|undefined;
 if(!sourceId){const {data,error}=await db.from("imported_sources").insert({user_id:userId,source_type:sourceType,external_id:externalId,content,processing_status:"uploaded",file_metadata:{title:title.slice(0,240),characterCount:content.length},user_context:sourceType==="imessage"?{direction:"sent_only",confirmedByUser:true}:{}}).select("id").single();if(error||!data)throw error ?? new Error("Could not save original text");sourceId=data.id;}
 const changes=await analyzeSource(userId,sourceId!);
 const {data:items,error:itemsError}=await db.from("extraction_items").select("title,normalized_type,due_at,confidence,classification_reason,required,optionality,review_status").eq("user_id",userId).eq("imported_source_id",sourceId).limit(100);if(itemsError)throw itemsError;
 return {id:sourceId,...changes,items,itemCount:items?.length ?? 0,pendingCount:(items ?? []).filter(item=>item.review_status==="pending"||item.review_status==="approved").length};
}
