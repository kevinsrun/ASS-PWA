import {loadSourceModule as load} from './load-source-module.mjs';
const {generateOllamaJSON,ollamaConfiguration}=load('@/lib/ai/ollama');
const {validLowRiskTriage,localEmailTriagePrompt,localEmailTriageSchema}=load('@/lib/ai/emailTriage');
const cases=[
['junk_filter','Shop now','Huge clearance sale. Free shipping on every order.','SPAM',true],
['email_triage','Weekly digest','Our weekly digest contains product updates.','NEWSLETTER',true],
['task_detection','Form request','Please complete the attached form.','TASK',false],
['deadline_detection','Application','Registration closes Friday.','DEADLINE',false],
['calendar_detection','Confirmed appointment','Your appointment is confirmed for 2026-10-06 at 14:00.','EVENT',false],
['response_needed','Availability','Please reply with your availability.','TASK',false],
['academic_schedule','Required class','Attendance is required at our Monday lecture.','EVENT',false],
['document_reference','History notes','The revolution began in 1789. This date is historical, not a deadline.','REFERENCE',false],
['calendar_detection','Optional talk','You may attend the seminar if interested. No attendance has been confirmed.','REFERENCE',false],
['task_detection','Application reminder','Please submit your application. This is not a meeting.','TASK',false],
['document_reference','Sample syllabus','This example timetable is a reference only, not your schedule.','REFERENCE',false],
['email_triage','Research digest','Research grant opportunity: applications close next month.','DEADLINE',true],
];
const schema=localEmailTriageSchema;
const models=process.argv.slice(2);if(!models.length)throw new Error('Supply installed candidate model tags');
for(const model of models){let correct=0,evidenceValid=0,escalations=0,eventFalsePositives=0;const timings=[],categories={};
for(const [category,subject,body,label,bulk] of cases){const input={subject,body,bulk,sender:'digest@example.com',snippet:body};
try{const result=await generateOllamaJSON(localEmailTriagePrompt(input),schema,model);const p=result.value,matched=p.classification===label;
correct+=Number(matched);evidenceValid+=Number(typeof p.evidence==='string'&&p.evidence.length>=8&&`${subject}\n${body}`.includes(p.evidence));escalations+=Number(p.escalate||p.confidence<.97||!validLowRiskTriage(input,p));eventFalsePositives+=Number(p.classification==='EVENT'&&label!=='EVENT');timings.push(result.latencyMs);categories[category]??={correct:0,total:0};categories[category].correct+=Number(matched);categories[category].total++;console.log(JSON.stringify({model,category,expected:label,predicted:p.classification,latencyMs:result.latencyMs}));
}catch(error){escalations++;console.log(JSON.stringify({model,category,error:error.message}));}}
const config=ollamaConfiguration(),memory=await fetch(`${config.baseUrl}/api/ps`).then(r=>r.json()).catch(()=>({models:[]}));const loaded=memory.models?.find(row=>row.name===model||row.model===model);
console.log(JSON.stringify({stage:'benchmark-summary',model,syntheticCases:cases.length,classificationAccuracy:correct/cases.length,evidenceExtractionAccuracy:evidenceValid/cases.length,escalationRate:escalations/cases.length,eventFalsePositives,weightedErrors:(cases.length-correct)+4*eventFalsePositives,coldLatencyMs:timings[0]??null,averageWarmLatencyMs:timings.length>1?timings.slice(1).reduce((a,b)=>a+b,0)/(timings.length-1):null,loadedModelBytes:loaded?.size??null,vramBytes:loaded?.size_vram??null,categories,note:'Synthetic smoke evaluation, not production accuracy or validated call reduction. Loaded model size is not process RSS.'}));
await fetch(`${config.baseUrl}/api/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,keep_alive:0}),signal:AbortSignal.timeout(5000)}).catch(()=>{});
}
