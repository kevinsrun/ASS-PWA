import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";

const keys =
  process.env.GEMINI_API_KEYS?.split(",").map((k) => k.trim()) ?? [];

let currentKeyIndex = 0;

export function getGeminiModel(model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash", responseSchema?: Schema) {
  if (keys.length === 0) {
    throw new Error("No Gemini API keys configured");
  }

  const key = keys[currentKeyIndex];

  const genAI = new GoogleGenerativeAI(key);

  const selected = genAI.getGenerativeModel({
    model,
    ...(responseSchema ? { generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.1 } } : {}),
  });
  const generate=selected.generateContent.bind(selected);
  selected.generateContent=async(...args)=>{
    try{return await generate(...args);}
    catch(error){
      const status=(error as {status?:number})?.status;
      const fallback=process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.6-flash";
      if(model===fallback||!model.includes("flash")||!(status===503||(status===404&&/model.*(?:no longer available|not found)/i.test(String(error)))))throw error;
      console.warn(JSON.stringify({service:"gemini",stage:"model-fallback",from:model,to:fallback,status}));
      return genAI.getGenerativeModel({model:fallback,...(responseSchema?{generationConfig:{responseMimeType:"application/json",responseSchema,temperature:.1}}:{})}).generateContent(...args);
    }
  };
  return selected;
}

export function rotateGeminiKey() {
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  console.log("Rotated Gemini key:", currentKeyIndex);
}
