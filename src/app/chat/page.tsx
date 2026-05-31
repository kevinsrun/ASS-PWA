"use client";

import { useState } from "react";
import { Bot, Code2, Mail, Send, X } from "lucide-react";
import { addMinutesToLabel, formatTimeLabel, getTodayString } from "@/lib/dateTime";
import { ChatMessage, PlanCategory } from "@/lib/types";
import { useAppContext } from "@/providers/AppProvider";

const starterMessage: ChatMessage = {
  role: "assistant",
  content:
    "Tell me what you want to plan, write, or build. I can use your saved ASS context when it helps.",
  createdAt: new Date().toISOString(),
};

type ChatTool = "none" | "email" | "code";

function parseDateFromText(text: string) {
  const today = new Date(`${getTodayString()}T00:00:00`);
  if (/\btoday\b/i.test(text)) return getTodayString();
  if (/\btomorrow\b/i.test(text)) {
    today.setDate(today.getDate() + 1);
    return today.toISOString().split("T")[0];
  }

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3]
      ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3])
      : today.getFullYear();
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }

  return getTodayString();
}

function parseTimeFromText(text: string) {
  const time = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (time) {
    let hour = Number(time[1]);
    const minute = time[2] ?? "00";
    const period = time[3].toLowerCase();
    if (period === "pm" && hour !== 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  const military = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return military ? `${military[1].padStart(2, "0")}:${military[2]}` : null;
}

function parseDurationFromText(text: string) {
  const minutes = text.match(/\bfor\s+(\d{1,3})\s*(?:min|mins|minutes)\b/i);
  if (minutes) return Number(minutes[1]);

  const hours = text.match(/\bfor\s+(\d(?:\.\d)?)\s*(?:hr|hrs|hour|hours)\b/i);
  if (hours) return Math.round(Number(hours[1]) * 60);

  return 60;
}

function inferCategory(text: string): PlanCategory {
  if (/gym|workout|run|fitness/i.test(text)) return "fitness";
  if (/class|school|study|exam|homework/i.test(text)) return "school";
  if (/doctor|health|dentist|therapy/i.test(text)) return "health";
  if (/bill|bank|money|finance/i.test(text)) return "finance";
  if (/work|meeting|client|shift|job/i.test(text)) return "work";
  return "personal";
}

export default function ChatPage() {
  const {
    todos,
    habits,
    plans,
    journals,
    chatMessages,
    codingWorkflows,
    profile,
    addPlan,
    addTodo,
    addHabit,
    setChatMessages,
    addCodingWorkflow,
    updateCodingWorkflow,
    deleteCodingWorkflow,
  } = useAppContext();

  const messages = chatMessages.length ? chatMessages : [starterMessage];
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<ChatTool>("none");
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailInfo, setEmailInfo] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [workflowObjective, setWorkflowObjective] = useState("");

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];

    setChatMessages(nextMessages);
    setInput("");
    setLoading(true);

    const todoIntent =
      /\b(add|create|make)\b/i.test(text) &&
      /\b(todo|to-do|task)\b/i.test(text);
    const habitIntent =
      /\b(add|create|start|track)\b/i.test(text) &&
      /\b(habit|daily|routine)\b/i.test(text);
    const calendarIntent =
      /\b(add|schedule|put|create)\b/i.test(text) &&
      /\b(calendar|event|meeting|class|gym|appointment|plan|schedule)\b/i.test(text);
    const eventTime = parseTimeFromText(text);

    if (calendarIntent && eventTime) {
      const date = parseDateFromText(text);
      const duration = parseDurationFromText(text);
      const cleanedTitle =
        text
          .replace(/\b(add|schedule|put|create)\b/gi, "")
          .replace(/\b(to|on|my|the)?\s*calendar\b/gi, "")
          .replace(/\btoday\b|\btomorrow\b/gi, "")
          .replace(/\b(20\d{2}-\d{2}-\d{2})\b/g, "")
          .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, "")
          .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/gi, "")
          .replace(/\bfor\s+\d{1,3}\s*(min|mins|minutes)\b/gi, "")
          .replace(/\bfor\s+\d(?:\.\d)?\s*(hr|hrs|hour|hours)\b/gi, "")
          .trim() || "Calendar event";

      addPlan({
        title: cleanedTitle,
        date,
        startLabel: formatTimeLabel(eventTime),
        endLabel: addMinutesToLabel(eventTime, duration),
        recurrence: "none",
        category: inferCategory(text),
        priority: "medium",
        notes: `Added from AI chat: ${text}`,
      });

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Added "${cleanedTitle}" to your calendar on ${date} at ${formatTimeLabel(eventTime)}.`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } else if (todoIntent) {
      const title =
        text
          .replace(/\b(add|create|make)\b/gi, "")
          .replace(/\b(todo|to-do|task)\b/gi, "")
          .replace(/\bto my\b|\bmy\b/gi, "")
          .trim() || "New task";

      addTodo(title, /urgent|important|high/i.test(text) ? "high" : "medium", 60, null);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Added "${title}" to your to-dos.`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } else if (habitIntent) {
      const title =
        text
          .replace(/\b(add|create|start|track)\b/gi, "")
          .replace(/\b(habit|daily|routine)\b/gi, "")
          .replace(/\bto my\b|\bmy\b/gi, "")
          .trim() || "New habit";

      addHabit(title, {
        frequency: /weekday/i.test(text)
          ? "weekdays"
          : /weekend/i.test(text)
          ? "weekends"
          : "daily",
        category: inferCategory(text),
      });
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Added "${title}" to your habits.`,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          messages: nextMessages.slice(-20),
          todos,
          habits,
          plans,
          journals,
          codingWorkflows,
          profile,
        }),
      });

      const data = await response.json();
      setChatMessages((prev) =>
        [
          ...prev,
          {
            role: "assistant" as const,
            content: data.reply ?? "I could not generate a response.",
            createdAt: new Date().toISOString(),
          },
        ].slice(-80)
      );
    } catch (error) {
      console.error(error);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong while contacting the AI.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function writeEmail() {
    const body = `Hello,\n\n${emailInfo.trim()}\n\nThank you,\n${profile.displayName || "Kevin"}`;
    setEmailDraft(body);
    setInput(
      `Write this email more professionally.\nTo: ${emailRecipient}\nSubject: ${emailSubject}\n\n${emailInfo}`
    );
  }

  function openEmailDraft() {
    const params = new URLSearchParams({
      subject: emailSubject.trim() || "Follow up",
      body: emailDraft,
    });

    window.location.href = `mailto:${encodeURIComponent(
      emailRecipient.trim()
    )}?${params.toString()}`;
  }

  function createCodingWorkflow() {
    const objective = workflowObjective.trim() || input.trim();
    if (!objective) return;

    const repo = profile.githubRepo || "Set repo in Profile";
    const generatedPrompt = `ASS overnight coding request.

Repo: ${repo}
Objective:
${objective}

Use journal/chat/todo/calendar context only when relevant.
Create a new branch, make focused commits, run checks, open a draft PR, and do not merge main until Kevin approves.
Do not use leaked proprietary files or unauthorized code.`;

    addCodingWorkflow({
      title: objective.slice(0, 58),
      repo,
      branchPrefix: "ass/overnight",
      objective,
      sourceContext: ["journal", "chat", "todos", "calendar", "habits"],
      guardrails: [
        "Create a branch.",
        "Open a draft PR.",
        "Do not merge main without final review.",
        "No leaked proprietary files.",
      ],
      status: "draft",
      generatedPrompt,
    });

    setWorkflowObjective("");
    setInput(`Turn this into a precise coding plan for a draft PR:\n${objective}`);
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-4xl flex-col px-4 py-8 sm:px-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-emerald-950">AI Chat</h1>
            <p className="mt-1 text-sm text-slate-600">
              Chat first. Tools open only when you need them.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTool(activeTool === "email" ? "none" : "email")}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-100 bg-white px-3 text-sm text-emerald-700"
            >
              <Mail size={16} />
              Email
            </button>
            <button
              onClick={() => setActiveTool(activeTool === "code" ? "none" : "code")}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-100 bg-white px-3 text-sm text-blue-700"
            >
              <Code2 size={16} />
              Code
            </button>
          </div>
        </header>

        {activeTool !== "none" && (
          <section className="ios-card mt-5 rounded-3xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-emerald-950">
                {activeTool === "email" ? "Email Function" : "Overnight Coding Function"}
              </h2>
              <button onClick={() => setActiveTool("none")} className="rounded-full p-2">
                <X size={16} />
              </button>
            </div>

            {activeTool === "email" ? (
              <div className="grid gap-2">
                <input
                  value={emailRecipient}
                  onChange={(event) => setEmailRecipient(event.target.value)}
                  placeholder="Recipient"
                  className="min-h-12 rounded-xl border border-emerald-100 px-4"
                />
                <input
                  value={emailSubject}
                  onChange={(event) => setEmailSubject(event.target.value)}
                  placeholder="Subject"
                  className="min-h-12 rounded-xl border border-emerald-100 px-4"
                />
                <textarea
                  value={emailInfo}
                  onChange={(event) => setEmailInfo(event.target.value)}
                  placeholder="What should the email say?"
                  className="min-h-24 rounded-xl border border-emerald-100 p-4"
                />
                <div className="flex flex-wrap gap-2">
                  <button onClick={writeEmail} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-white">
                    Draft in Chat
                  </button>
                  <button
                    onClick={openEmailDraft}
                    disabled={!emailDraft}
                    className="min-h-11 rounded-xl border px-4 text-blue-700 disabled:opacity-50"
                  >
                    Open Mail Draft
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
                  GitHub repo: {profile.githubRepo || "set this in Profile first"}
                </div>
                <textarea
                  value={workflowObjective}
                  onChange={(event) => setWorkflowObjective(event.target.value)}
                  placeholder="What should ASS code overnight?"
                  className="min-h-28 rounded-xl border border-blue-100 p-4"
                />
                <button onClick={createCodingWorkflow} className="min-h-11 rounded-xl bg-blue-600 px-4 text-white">
                  Save as Draft PR Workflow
                </button>
                {codingWorkflows.slice(0, 3).map((workflow) => (
                  <div key={workflow.id} className="rounded-xl border bg-white p-3 text-sm">
                    <div className="font-semibold">{workflow.title}</div>
                    <div className="text-xs text-slate-500">{workflow.status} / {workflow.repo}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => updateCodingWorkflow(workflow.id, { status: "approved" })}
                        className="rounded-lg bg-gray-900 px-3 py-1 text-xs text-white"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => deleteCodingWorkflow(workflow.id)}
                        className="rounded-lg border px-3 py-1 text-xs text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="ios-card mt-5 flex-1 space-y-3 overflow-y-auto rounded-3xl p-4">
          {messages.map((message, index) => (
            <div
              key={`${message.createdAt ?? "message"}-${index}`}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl bg-gray-900 px-4 py-3 text-white"
                  : "mr-auto max-w-[88%] whitespace-pre-wrap rounded-2xl bg-emerald-50 px-4 py-3 text-gray-900"
              }
            >
              {message.role === "assistant" && (
                <Bot className="mb-2 inline text-emerald-600" size={16} />
              )}
              <div>{message.content}</div>
            </div>
          ))}
          {loading && (
            <div className="mr-auto rounded-2xl bg-gray-100 px-4 py-3 text-gray-500">
              Thinking...
            </div>
          )}
        </section>

        <div className="ios-card mt-4 flex gap-2 rounded-3xl p-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") sendMessage();
            }}
            placeholder="Message ASS..."
            className="min-h-12 min-w-0 flex-1 rounded-2xl border border-emerald-100 bg-white px-4 outline-none focus:border-emerald-400"
          />
          <button
            onClick={sendMessage}
            disabled={loading}
            className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-emerald-600 px-4 text-white disabled:opacity-50"
          >
            <Send size={16} />
            Send
          </button>
        </div>
      </main>
    </div>
  );
}
