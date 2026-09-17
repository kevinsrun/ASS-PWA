"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Code2, Mail, Send, X } from "lucide-react";
import { ChatMessage } from "@/lib/types";
import type { AssistantActionResult } from "@/lib/assistantActionExecutor";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";

const starterMessage: ChatMessage = {
  role: "assistant",
  content:
    "Tell me what you want to plan, write, or build. I can use your saved ASS context when it helps.",
  createdAt: new Date().toISOString(),
};

type ChatTool = "none" | "email" | "code";
type PendingAction = AssistantActionResult & { runId: string };

export default function ChatPage() {
  const {
    chatMessages,
    codingWorkflows,
    profile,
    setChatMessages,
    addCodingWorkflow,
    updateCodingWorkflow,
    deleteCodingWorkflow,
    reloadCloud,
  } = useAppContext();
  const { session } = useAuth();

  const messages = chatMessages.length ? chatMessages : [starterMessage];
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<ChatTool>("none");
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailInfo, setEmailInfo] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [workflowObjective, setWorkflowObjective] = useState("");
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [chatError, setChatError] = useState("");
  const [toolProgress,setToolProgress]=useState("Thinking…");
  const readingRef = useRef<HTMLElement>(null);
  useEffect(() => { readingRef.current?.scrollTo({ top: readingRef.current.scrollHeight, behavior: "smooth" }); }, [messages.length, loading, pendingActions.length]);

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
    setToolProgress("Checking your request…");

    try {
      if (!session?.access_token) throw new Error("Sign in so ASS can safely execute actions.");
      const response = await fetch("/api/chat/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          message: text,
          messages: nextMessages.slice(-20),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if(!response.ok){const error=await response.json();throw new Error(error.error ?? "ASS could not complete the request");}
      if(!response.body)throw new Error("Agent response stream is unavailable");
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
      let data:{reply?:string;error?:string;runId?:string;actionResults?:AssistantActionResult[];sources?:ChatMessage["sources"];reconnect?:boolean}|null=null;
      while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let newline;while((newline=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;const event=JSON.parse(line);if(event.type==="progress")setToolProgress(event.message);if(event.type==="error")throw new Error(event.error);if(event.type==="result")data=event;}if(done)break;}
      if(!data)throw new Error("The agent response ended before completion. Check Inbox/calendar before retrying actions.");
      const awaiting = (data.actionResults ?? []).filter((result) => result.status === "requires_confirmation");
      if (data.runId) setPendingActions(awaiting.map((result) => ({ ...result, runId: data.runId! })));
      await reloadCloud();
      window.localStorage.setItem("ass_refresh_at",String(Date.now()));window.dispatchEvent(new Event("ass:data-changed"));
      setChatError("");
      setChatMessages((prev) =>
        [
          ...prev,
          {
            role: "assistant" as const,
            content: data.reply ?? "I could not generate a response.",
            sources:data.sources,reconnect:data.reconnect,
            createdAt: new Date().toISOString(),
          },
        ].slice(-80)
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Something went wrong while contacting the AI.";
      setChatError(message);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: message,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function decideAction(item: PendingAction, confirm: boolean) {
    if (!confirm) { setPendingActions((current) => current.filter((candidate) => candidate !== item)); return; }
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ runId: item.runId, confirmedActions: [item.suggestedAction ?? item.action], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      const data = await response.json() as { reply?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The action could not be completed.");
      setChatMessages((current) => [...current, { role: "assistant", content: data.reply ?? "Action completed.", createdAt: new Date().toISOString() }]);
      setPendingActions((current) => current.filter((candidate) => candidate !== item));
      await reloadCloud();
    } catch (error) { setChatError(error instanceof Error ? error.message : "The action could not be completed."); }
    finally { setLoading(false); }
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
      <main className="chat-page mx-auto flex min-h-[calc(100dvh-6rem)] max-w-3xl flex-col px-4 py-8 sm:px-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">ASS</h1>
          </div>
          <details className="chat-tools">
            <summary>Tools</summary><div className="flex gap-2">
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
          </details>
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

        <section ref={readingRef} className="chat-reading mt-5 flex-1 space-y-5 overflow-y-auto p-4" aria-live="polite">
          {messages.map((message, index) => (
            <div
              key={`${message.createdAt ?? "message"}-${index}`}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[82%] whitespace-pre-wrap rounded-2xl bg-gray-900 px-4 py-3 text-white"
                  : "assistant-response mr-auto max-w-[94%] whitespace-pre-wrap"
              }
            >
              {message.role === "assistant" && <Bot className="mb-2 inline text-slate-400" size={16} />}
              <div>{message.content}</div>
              {message.sources?.length ? <div className="chat-source-chips" aria-label="Sources">{message.sources.map(source=><a key={source.url} href={source.url} target={source.url.startsWith("https://")?"_blank":undefined} rel="noreferrer">{source.label}</a>)}</div> : null}
              {message.reconnect ? <a className="chat-reconnect" href="/profile">Review connected accounts</a> : null}
            </div>
          ))}
          {loading && (
            <div className="chat-thinking mr-auto rounded-2xl px-4 py-3" role="status">
              {toolProgress}
            </div>
          )}
          {pendingActions.map((item) => {
            const action = item.suggestedAction ?? item.action;
            return <article className="chat-action-card" key={`${item.runId}-${item.type}-${action.sourceId}`}><small>ASS ACTION</small><strong>{action.title ?? item.type.replaceAll("_", " ")}</strong>{action.start && action.end ? <p>{new Date(action.start).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}–{new Date(action.end).toLocaleTimeString([], { timeStyle: "short" })}</p> : null}{item.conflicts?.length ? <p className="chat-action-warning">Conflicts with {item.conflicts.join(", ")}</p> : null}<div><button type="button" disabled={loading} onClick={() => void decideAction(item, true)}>Confirm</button><button type="button" disabled={loading} onClick={() => void decideAction(item, false)}>Cancel</button></div></article>;
          })}
        </section>

        {chatError ? <p className="chat-error" role="alert">{chatError}</p> : null}
        <div className={`chat-composer mt-4 flex gap-2 rounded-3xl p-2 ${chatError ? "chat-composer--error" : ""}`}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
            }}
            placeholder="Message ASS..."
            disabled={loading}
            rows={1}
            aria-label="Message ASS"
            className="chat-input min-h-12 min-w-0 flex-1 resize-none rounded-2xl px-4 py-3"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={loading || !input.trim()}
            aria-label={loading ? "ASS is responding" : "Send message"}
            className="chat-send inline-flex min-h-12 items-center gap-2 rounded-2xl px-4"
          >
            <Send size={16} />
            Send
          </button>
        </div>
      </main>
    </div>
  );
}
