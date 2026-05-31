import { NextResponse } from "next/server";
import { getGeminiModel, rotateGeminiKey } from "@/lib/gemini";

export async function POST(req: Request) {
  try {
    const {
      message,
      messages,
      todos,
      habits,
      plans,
      journals,
      codingWorkflows,
      profile,
    } =
      await req.json();

    const prompt = `
You are ASS, an AI scheduling assistant.

You should talk normally, not only respond to commands.

You can:
- answer casual questions
- help the user think
- suggest to-dos
- suggest habits
- analyze journal context
- reason from existing tasks and plans
- help build schedules
- help turn journal/chat intent into coding plans
- be direct and useful

Do not say you can only help with planning.
Do not force the user to say exact commands like "plan my day".
If the user asks something general, respond naturally.
If the user asks for scheduling, use their app data.
If the user asks to add a calendar event, todo, or habit, the client may already handle the app mutation before this reply. In that case, acknowledge it and suggest the user check the relevant page.
If the user asks for coding, use their journal and chat context to clarify intent.
For GitHub coding workflows, only suggest work on repos the user owns or authorizes.
Never recommend using leaked proprietary model/system files.
Never say work should merge into main automatically; require a branch, draft PR, tests, and final human review.

Current app data:

Profile:
${JSON.stringify(profile, null, 2)}

Todos:
${JSON.stringify(todos, null, 2)}

Habits:
${JSON.stringify(habits, null, 2)}

Calendar plans:
${JSON.stringify(plans, null, 2)}

Journal entries:
${JSON.stringify(journals, null, 2)}

Recent chat:
${JSON.stringify(messages, null, 2)}

Saved coding workflows:
${JSON.stringify(codingWorkflows, null, 2)}

User message:
${message}
`;

    let result;

    try {
      const model = getGeminiModel();

      result = await model.generateContent(prompt);
    } catch (error: unknown) {
      const message = String(error);

      if (message.includes("429")) {
        rotateGeminiKey();

        const retryModel = getGeminiModel();

        result = await retryModel.generateContent(prompt);
      } else {
        throw error;
      }
    }

    const reply = result.response.text();

    return NextResponse.json({
      reply,
    });

  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { reply: "The AI chat route failed. Check the terminal logs." },
      { status: 500 }
    );
  }
}
