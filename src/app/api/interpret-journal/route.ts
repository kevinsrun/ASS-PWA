import { NextResponse } from "next/server";
import { getGeminiModel, rotateGeminiKey } from "@/lib/gemini";

export async function POST(req: Request) {
  try {
    const { journal } = await req.json();

    const prompt = `
You are an intelligent planning assistant.

Return ONLY valid JSON.
Do not use markdown.
Do not use code fences.

Extract:
1. todos
2. habits
3. plans
4. mood/stress/deadlines/intentions metadata for each relevant suggestion

Important rules:
- Preserve exact user times.
- If user says "5am", return "05:00".
- If user says "6pm", return "18:00".
- Never default to 08:00 unless absolutely no time is given.
- If user says "every day" or "daily", recurrence must be "daily".
- If user says weekdays, recurrence must be "weekdays".
- If user says weekends, recurrence must be "weekends".
- If recurrence is unusual, use "custom" and explain it in notes.
- Recurring behaviors should become habits.
- If a recurring behavior also includes a time, create both a habit and a plan.
- Detect mood, stress, deadlines, and intentions when they are present.

Examples:
"run every day at 5am" -> habit + plan at 05:00
"study chemistry tonight at 9pm" -> plan at 21:00

Format:
{
  "todos": [
    {
      "title": "",
      "priority": "low|medium|high",
      "deadline": null,
      "mood": "",
      "stress": "low|medium|high",
      "intention": ""
    }
  ],
  "habits": [
    {
      "title": "",
      "recurrence": "daily|weekly"
    }
  ],
  "plans": [
    {
      "title": "",
      "date": null,
      "time": "HH:mm",
      "duration": 60,
      "recurrence": "none|daily|weekly|weekdays|weekends|custom",
      "priority": "low|medium|high",
      "notes": "",
      "deadline": null,
      "mood": "",
      "stress": "low|medium|high",
      "intention": ""
    }
  ]
}

Journal:
${journal}
`;

    let result;

    try {
      const model = getGeminiModel();
      result = await model.generateContent(prompt);
    } catch (error: unknown) {
      const message = String(error);

      if (!message.includes("429")) {
        throw error;
      }

      rotateGeminiKey();
      const retryModel = getGeminiModel();
      result = await retryModel.generateContent(prompt);
    }

    const cleaned = result.response
      .text()
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return NextResponse.json(JSON.parse(cleaned));
  } catch (error) {
    console.error("GEMINI ERROR:", error);

    return NextResponse.json(
      { error: "Failed to interpret journal" },
      { status: 500 }
    );
  }
}
