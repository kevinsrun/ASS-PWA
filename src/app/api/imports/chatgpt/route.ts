import { NextRequest, NextResponse } from "next/server";
import { importChatGPTExport } from "@/lib/chatgptImport";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new ApiAuthError("Choose conversations.json or your ChatGPT export ZIP.", 400);
    if (!/\.(json|zip)$/i.test(file.name)) throw new ApiAuthError("Use conversations.json or a ChatGPT export ZIP.", 415);
    if (file.size > 100 * 1024 * 1024) throw new ApiAuthError("ChatGPT exports must be 100 MB or smaller.", 413);
    return NextResponse.json(await importChatGPTExport(user.id, { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) }));
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ChatGPT import failed." }, { status });
  }
}
