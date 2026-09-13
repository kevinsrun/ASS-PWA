"use client";

import Link from "next/link";
import { DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronRight, FileCheck2, FileText, Inbox, LoaderCircle, Upload, UserRound, X } from "lucide-react";
import type { EmailIntelligenceItem } from "@/lib/types";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";

type ExtractionItem = {
  id: string;
  item_type: string;
  title: string;
  description: string;
  due_at: string | null;
  confidence: number;
  required: boolean;
  review_status: "pending" | "approved" | "rejected" | "committed";
};

type ImportedFile = {
  id: string;
  name: string;
  source: string;
  byte_size: number;
  status: "uploaded" | "analyzing" | "extracted" | "needs_review" | "failed";
  classification: string | null;
  processing_error: string | null;
  created_at: string;
  last_analyzed_at: string | null;
  linked_project_local_id: number | null;
  linked_course: { id: string; name: string; course_code: string } | null;
  extraction: { summary: string; confidence: number } | null;
  items: ExtractionItem[];
};

const eventTypes = new Set(["meeting", "club_event", "interview", "travel"]);

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function human(value: string | null) {
  return value ? value.replaceAll("_", " ") : "analyzing";
}

export default function InboxPage() {
  const { session } = useAuth();
  const { reloadCloud } = useAppContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [emailItems, setEmailItems] = useState<EmailIntelligenceItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token ?? ""}` }), [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const [fileResponse, feedResponse] = await Promise.all([
        fetch("/api/files", { headers: headers(), cache: "no-store" }),
        fetch("/api/intelligence/feed", { headers: headers(), cache: "no-store" }),
      ]);
      const fileBody = await fileResponse.json();
      const feedBody = await feedResponse.json();
      if (!fileResponse.ok) throw new Error(fileBody.error || "Could not load files");
      if (!feedResponse.ok) throw new Error(feedBody.error || "Could not load assistant actions");
      setFiles(fileBody.files ?? []);
      setEmailItems((feedBody.items ?? []).filter((item: EmailIntelligenceItem) => item.accountEmail !== "ASS"));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Inbox is unavailable");
    }
  }, [headers, session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  async function upload(selected: FileList | File[], source: "local" | "drag_drop") {
    if (!session?.access_token || selected.length === 0) return;
    for (const file of Array.from(selected)) {
      setBusy(`upload:${file.name}`);
      setError(null);
      const form = new FormData();
      form.set("file", file);
      form.set("source", source);
      try {
        const response = await fetch("/api/files", { method: "POST", headers: headers(), body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Could not import ${file.name}`);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : `Could not import ${file.name}`);
      }
    }
    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";
    await load();
    await reloadCloud();
  }

  async function review(itemId: string, action: "approve" | "reject") {
    setBusy(itemId);
    try {
      const response = await fetch("/api/files/actions", {
        method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ itemId, action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save your decision");
      await load();
      await reloadCloud();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save your decision");
    } finally {
      setBusy(null);
    }
  }

  async function decide(id: string, action: "going" | "maybe" | "not_going" | "add_to_calendar" | "ignore") {
    setBusy(id);
    try {
      const response = await fetch("/api/intelligence/feed", {
        method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ id, action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save your decision");
      setEmailItems((current) => current.filter((item) => item.id !== id));
      await reloadCloud();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save your decision");
    } finally {
      setBusy(null);
    }
  }

  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files, "drag_drop");
  }

  const pendingFiles = files.filter((file) => file.items.some((item) => item.review_status === "pending"));

  return (
    <main className="inbox-page">
      <header className="inbox-header">
        <div><p>Review before it changes your life OS</p><h1>Inbox</h1></div>
        <Link href="/profile" aria-label="Open profile"><UserRound size={20} /></Link>
      </header>

      <button
        className={`file-drop-zone${dragging ? " is-dragging" : ""}`}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        {busy?.startsWith("upload:") ? <LoaderCircle className="is-spinning" size={23} /> : <Upload size={23} />}
        <span><strong>{busy?.startsWith("upload:") ? "Reading your file…" : "Drop a file here"}</strong><small>PDF, Word, Excel, PowerPoint, text, CSV, PNG or JPG · 25 MB max</small></span>
        <ChevronRight size={18} />
      </button>
      <input ref={inputRef} className="visually-hidden" type="file" multiple accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg" onChange={(event) => event.target.files && void upload(event.target.files, "local")} />

      {error ? <div className="inbox-error" role="alert"><AlertCircle size={18} /><span>{error}</span></div> : null}

      {emailItems.length ? (
        <section className="inbox-section">
          <div className="inbox-section-title"><span>Needs a decision</span><small>{emailItems.length}</small></div>
          <div className="decision-list">
            {emailItems.map((item) => {
              const isEvent = eventTypes.has(item.type);
              return (
                <article key={item.id} className={item.conflictDetails.length ? "has-conflict" : ""}>
                  <div className="decision-copy">
                    <small>{item.accountEmail} · {human(item.type)}</small>
                    <h2>{item.title}</h2>
                    <p>{item.conflictDetails.length ? `Conflicts with ${item.conflictDetails.join(", ")}.` : item.summary}</p>
                    {item.recommendations[0] ? <em>{item.recommendations[0]}</em> : null}
                  </div>
                  <div className="decision-actions">
                    {isEvent ? <>
                      <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id, "going")}>Going</button>
                      <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id, "maybe")}>Maybe</button>
                      <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id, "not_going")}>Not going</button>
                      <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id, "add_to_calendar")}>Add</button>
                    </> : null}
                    <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id, "ignore")}>Ignore</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="inbox-section">
        <div className="inbox-section-title"><span>Files</span><small>{files.length}</small></div>
        {files.length === 0 ? (
          <div className="inbox-empty"><Inbox size={22} /><div><strong>Nothing waiting</strong><p>Import a syllabus, assignment, reading, dataset, or financial document.</p></div></div>
        ) : (
          <div className="file-list">
            {[...pendingFiles, ...files.filter((file) => !pendingFiles.includes(file))].map((file) => (
              <article key={file.id} className="file-card">
                <div className="file-card-heading">
                  {file.status === "failed" ? <AlertCircle size={20} /> : file.status === "extracted" ? <FileCheck2 size={20} /> : <FileText size={20} />}
                  <div><h2>{file.name}</h2><p>{human(file.classification)} · {fileSize(file.byte_size)} · {file.linked_course?.course_code || (file.linked_project_local_id ? `Project ${file.linked_project_local_id}` : "Unlinked")} · {file.last_analyzed_at ? `Analyzed ${new Date(file.last_analyzed_at).toLocaleDateString()}` : `Added ${new Date(file.created_at).toLocaleDateString()}`}</p></div>
                  <span className={`file-status is-${file.status}`}>{human(file.status)}</span>
                </div>
                {file.processing_error ? <p className="file-failure">{file.processing_error}</p> : file.extraction?.summary ? <p className="file-summary">{file.extraction.summary}</p> : null}
                {file.items.some((item) => item.review_status === "pending") ? (
                  <div className="extraction-list">
                    {file.items.filter((item) => item.review_status === "pending").map((item) => (
                      <div key={item.id} className="extraction-item">
                        <div><small>{human(item.item_type)} · {Math.round(Number(item.confidence) * 100)}% confidence</small><strong>{item.title}</strong>{item.due_at ? <time>{new Date(item.due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time> : null}</div>
                        <div><button aria-label={`Approve ${item.title}`} disabled={busy === item.id} type="button" onClick={() => void review(item.id, "approve")}><Check size={17} /></button><button aria-label={`Ignore ${item.title}`} disabled={busy === item.id} type="button" onClick={() => void review(item.id, "reject")}><X size={17} /></button></div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
