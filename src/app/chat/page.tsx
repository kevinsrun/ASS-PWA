"use client";

import { useState } from "react";
import { useAppContext } from "@/providers/AppProvider";
import { ChatMessage } from "@/lib/types";
import {
  buildTimeBlocks,
  getIncompleteTodos,
  getPendingHabits,
} from "@/lib/planner";

function buildPlannerResponse(
  input: string,
  todos: Parameters<typeof getIncompleteTodos>[0],
  habits: Parameters<typeof getPendingHabits>[0]
) {
  const incompleteTodos = getIncompleteTodos(todos);
  const pendingHabits = getPendingHabits(habits);

  const lowered = input.toLowerCase();

  if (
    lowered.includes("plan my day") ||
    lowered.includes("schedule") ||
    lowered.includes("time block")
  ) {
    const blocks = buildTimeBlocks(todos, habits);

    if (blocks.length === 0) {
      return "You are caught up. There are no pending habits or unfinished to-dos to schedule.";
    }

    return [
      "Here is a suggested time-blocked plan for today:",
      "",
      ...blocks,
      "",
      "This is a draft plan based on your current habits and unfinished to-dos.",
    ].join("\n");
  }

  if (lowered.includes("what should i do next")) {
    if (pendingHabits.length > 0) {
      return `Start with "${pendingHabits[0].name}" so you keep your habit streak moving.`;
    }

    if (incompleteTodos.length > 0) {
      return `Your best next task is "${incompleteTodos[0].title}" because it is the highest-priority unfinished to-do.`;
    }

    return "You are caught up right now.";
  }

  return [
    "I can help plan your day.",
    'Try asking: "Plan my day", "Schedule my day", or "What should I do next?"',
    "",
    `You currently have ${incompleteTodos.length} unfinished to-dos and ${pendingHabits.length} pending habits.`,
  ].join("\n");
}

export default function ChatPage() {
  const { todos, habits } = useAppContext();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        'I can help plan your day using your current to-dos and habits. Try asking "Plan my day".',
    },
  ]);
  const [input, setInput] = useState("");

  function sendMessage() {
    const text = input.trim();
    if (!text) return;

    const assistantReply = buildPlannerResponse(text, todos, habits);

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: assistantReply },
    ]);

    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      sendMessage();
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto flex max-w-3xl flex-col px-6 py-10">
        <h1 className="text-3xl font-bold">AI Chat</h1>
        <p className="mt-2 text-gray-600">
          Ask the planner to organize your habits and to-dos.
        </p>

        <div className="mt-6 space-y-3 rounded-2xl border bg-white p-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-gray-900 px-4 py-3 text-white"
                  : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-gray-100 px-4 py-3 text-gray-900"
              }
            >
              {message.content}
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Ask: "Plan my day"'
            className="flex-1 rounded-xl border bg-white px-4 py-3 outline-none"
          />
          <button
            onClick={sendMessage}
            className="rounded-xl bg-gray-900 px-4 py-3 text-white"
          >
            Send
          </button>
        </div>
      </main>
    </div>
  );
}