"use client";

import Link from "next/link";
import { DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronRight, FileCheck2, FileText, Inbox, LoaderCircle, Send, Upload, UserRound } from "lucide-react";
import type { EmailIntelligenceItem } from "@/lib/types";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";
import ExtractionReview from "@/components/ExtractionReview";

type ExtractionItem = {
  id: string;
  item_type: string;
  title: string;
  description: string;
  due_at: string | null;
  confidence: number;
  required: boolean;
  normalized_type: string | null;
  review_status: "pending" | "approved" | "rejected" | "committed";
  payload?: Record<string,unknown>;
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

type ImportedText = {
  id: string;
  title: string;
  source_type: string;
  processing_status: "uploaded" | "analyzing" | "extracted" | "needs_review" | "failed";
  processing_error: string | null;
  created_at: string;
  last_analyzed_at: string | null;
  extraction: { summary: string; confidence: number } | null;
  items: ExtractionItem[];
};
type DriveAccount = { id: string; email: string | null; name: string | null };
type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };
type EmailDraft = { id: string; recipient: string | null; subject: string; body: string; status: string; created_at: string };

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
  const chatGPTRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [texts, setTexts] = useState<ImportedText[]>([]);
  const [emailItems, setEmailItems] = useState<EmailIntelligenceItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversionTypes, setConversionTypes] = useState<Record<string, string>>({});
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textSource, setTextSource] = useState("pasted_text");
  const [driveAccounts, setDriveAccounts] = useState<DriveAccount[]>([]);
  const [driveAccountId, setDriveAccountId] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [draftBodies, setDraftBodies] = useState<Record<string, string>>({});

  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token ?? ""}` }), [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const [fileResponse, feedResponse, driveResponse, draftResponse] = await Promise.all([
        fetch("/api/files", { headers: headers(), cache: "no-store" }),
        fetch("/api/intelligence/feed", { headers: headers(), cache: "no-store" }),
        fetch("/api/drive/files", { headers: headers(), cache: "no-store" }),
        fetch("/api/gmail/drafts", { headers: headers(), cache: "no-store" }),
      ]);
      const fileBody = await fileResponse.json();
      const feedBody = await feedResponse.json();
      const driveBody = await driveResponse.json();
      const draftBody = await draftResponse.json();
      if (!fileResponse.ok) throw new Error(fileBody.error || "Could not load files");
      if (!feedResponse.ok) throw new Error(feedBody.error || "Could not load assistant actions");
      setFiles(fileBody.files ?? []);
      setTexts(fileBody.texts ?? []);
      setEmailItems(feedBody.items ?? []);
      if (driveResponse.ok) { setDriveAccounts(driveBody.accounts ?? []); setDriveAccountId((current) => current || driveBody.accounts?.[0]?.id || ""); }
      if (draftResponse.ok) setDrafts(draftBody.drafts ?? []);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Inbox is unavailable");
    }
  }, [headers, session?.access_token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(()=>{const refresh=()=>void load();const crossTab=(event:StorageEvent)=>{if(event.key==="ass_refresh_at")refresh();};window.addEventListener("ass:data-changed",refresh);window.addEventListener("focus",refresh);window.addEventListener("storage",crossTab);return()=>{window.removeEventListener("ass:data-changed",refresh);window.removeEventListener("focus",refresh);window.removeEventListener("storage",crossTab);};},[load]);

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

  async function handleDraft(id: string, action: "save" | "ignore") {
    setBusy(`draft:${id}`); setError(null);
    try { const response = await fetch("/api/gmail/drafts", { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ id, action, draftBody: draftBodies[id] }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not update this draft"); setDrafts((current) => current.filter((draft) => draft.id !== id)); setNotice(action === "save" ? "Saved to Gmail Drafts. Nothing was sent." : "Marked as no response needed."); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update this draft"); }
    finally { setBusy(null); }
  }

  async function browseDrive() {
    if (!driveAccountId) return;
    setBusy("drive-browse"); setError(null);
    try { const response = await fetch(`/api/drive/files?accountId=${encodeURIComponent(driveAccountId)}&folder=Grow%20Up`, { headers: headers(), cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not open Grow Up"); setDriveFiles(body.files ?? []); if (!body.folder) setNotice("No folder named “Grow Up” was found in this account."); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not open Google Drive"); }
    finally { setBusy(null); }
  }

  async function importDriveFile(fileId: string) {
    setBusy(`drive:${fileId}`); setError(null); setNotice(null);
    try { const response = await fetch("/api/drive/files", { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ accountId: driveAccountId, fileId }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not import this Drive file"); setNotice(body.pendingCount ? `Drive file analyzed. Review ${body.pendingCount} suggested action${body.pendingCount === 1 ? "" : "s"}.` : "Drive file imported successfully."); await load(); await reloadCloud(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not import this Drive file"); }
    finally { setBusy(null); }
  }

  async function importText() {
    if (!session?.access_token || !textContent.trim()) return;
    setBusy("text-import"); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/imports/text", { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ title: textTitle, content: textContent, sourceType: textSource }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not analyze this text");
      setTextTitle(""); setTextContent("");
      window.sessionStorage.setItem("ass_selected_context",JSON.stringify({kind:"source",id:body.id,at:Date.now()}));
      setNotice(body.pendingCount ? `Analysis complete. Review ${body.pendingCount} suggestion${body.pendingCount === 1 ? "" : "s"}. Nothing was added to your calendar or tasks.` : "Analysis complete. No pending suggestions need review.");
      await load(); await reloadCloud();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not analyze this text"); }
    finally { setBusy(null); }
  }

  async function importChatGPT(file?: File) {
    if (!session?.access_token || !file) return;
    setBusy("chatgpt-import"); setError(null); setNotice(null);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/imports/chatgpt", { method: "POST", headers: headers(), body: form }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not import ChatGPT history");
      setNotice(`Imported ${body.conversations} conversations and ${body.userMessages} of your messages. Learned ${body.memories} explicit preferences or goals.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not import ChatGPT history"); }
    finally { setBusy(null); if (chatGPTRef.current) chatGPTRef.current.value = ""; }
  }

  async function reanalyze(id:string,isFile:boolean) {
    window.sessionStorage.setItem("ass_selected_context",JSON.stringify({kind:isFile?"file":"source",id,at:Date.now()}));
    setBusy(`reanalyze:${id}`); setError(null);
    if(isFile)setFiles(current=>current.map(file=>file.id===id?{...file,status:"analyzing",processing_error:null}:file));else setTexts(current=>current.map(source=>source.id===id?{...source,processing_status:"analyzing",processing_error:null}:source));
    try {
      const response=await fetch("/api/files/reanalyze",{method:"POST",headers:{...headers(),"Content-Type":"application/json"},body:JSON.stringify(isFile ? {fileId:id} : {sourceId:id})});
      const body=await response.json(); if(!response.ok)throw new Error(body.error ?? "Re-analysis failed");
      const reclassified=(body.changes ?? []).filter((change:{from:string;to:string})=>change.from!==change.to).length;
      setNotice(`Re-analysis complete · ${reclassified} reclassified · ${body.added} new suggestions · ${body.removedFalseEvents ?? 0} unsupported calendar suggestions removed · ${body.preserved} decisions preserved. No existing calendar events or tasks were deleted.`); await load();await reloadCloud();window.localStorage.setItem("ass_refresh_at",String(Date.now()));
    } catch(error) {setError(error instanceof Error ? error.message : "Re-analysis failed");await load();} finally {setBusy(null);}
  }
  async function review(itemId: string, action: "approve" | "reject", normalizedType?:string) {
    setBusy(itemId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/files/actions", {
        method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ itemId, action, normalizedType: normalizedType ?? conversionTypes[itemId] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save your decision");
      await load();
      await reloadCloud();
      if (action === "approve") setNotice(body.warning ? `Saved in ASS. Google sync needs attention: ${body.warning}` : "Review saved. Only the selected object type was created.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save your decision");
    } finally {
      setBusy(null);
    }
  }

  async function decide(id: string, action: "accept" | "going" | "maybe" | "not_going" | "add_to_calendar" | "ignore") {
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

      <section className="text-import-card" aria-label="Paste text to analyze">
        <div className="text-import-heading"><div><strong>Paste text</strong><small>Notes, schedules, copied email, or your sent-message export</small></div><select aria-label="Text source" value={textSource} onChange={(event) => setTextSource(event.target.value)}><option value="pasted_text">Pasted text</option><option value="manual_text">Manual notes</option><option value="imessage">My sent messages</option></select></div>
        <input aria-label="Import title" value={textTitle} onChange={(event) => setTextTitle(event.target.value)} placeholder="Title (optional)" />
        <textarea aria-label="Text to analyze" value={textContent} maxLength={250000} onChange={(event) => {setTextContent(event.target.value);event.target.style.height="auto";event.target.style.height=`${Math.min(480,event.target.scrollHeight)}px`;}} placeholder="Paste content here…" rows={5} />
        <button type="button" disabled={!textContent.trim() || busy === "text-import"} onClick={() => void importText()}>{busy === "text-import" ? <LoaderCircle className="is-spinning" size={17} /> : <Send size={17} />}{busy === "text-import" ? "Analyzing…" : "Analyze"}</button>
        {textSource === "imessage" ? <small>Only paste messages you sent. ASS will not access Messages or scrape its database.</small> : null}
      </section>

      {driveAccounts.length ? <section className="drive-import-card"><div><strong>Google Drive</strong><small>Browse only files in “Grow Up”; nothing is imported until you choose it.</small></div><div><select aria-label="Google Drive account" value={driveAccountId} onChange={(event) => { setDriveAccountId(event.target.value); setDriveFiles([]); }}>{driveAccounts.map((account) => <option key={account.id} value={account.id}>{account.email || account.name || "Google account"}</option>)}</select><button type="button" disabled={busy === "drive-browse"} onClick={() => void browseDrive()}>{busy === "drive-browse" ? "Opening…" : "Browse Grow Up"}</button></div>{driveFiles.length ? <ul>{driveFiles.map((file) => <li key={file.id}><span><strong>{file.name}</strong><small>{file.modifiedTime ? `Modified ${new Date(file.modifiedTime).toLocaleDateString()}` : human(file.mimeType)}</small></span><button type="button" disabled={busy === `drive:${file.id}`} onClick={() => void importDriveFile(file.id)}>{busy === `drive:${file.id}` ? "Importing…" : "Import"}</button></li>)}</ul> : null}</section> : null}

      <section className="drive-import-card"><div><strong>ChatGPT history</strong><small>Import conversations.json or the downloaded export ZIP. Only your messages teach writing style.</small></div><div><button type="button" disabled={busy === "chatgpt-import"} onClick={() => chatGPTRef.current?.click()}>{busy === "chatgpt-import" ? "Learning…" : "Choose export"}</button></div><input ref={chatGPTRef} className="visually-hidden" type="file" accept=".json,.zip,application/json,application/zip" onChange={(event) => void importChatGPT(event.target.files?.[0])} /></section>

      {error ? <div className="inbox-error" role="alert"><AlertCircle size={18} /><span>{error}</span></div> : null}
      {notice ? <div className="inbox-notice" role="status"><Check size={18} /><span>{notice}</span></div> : null}

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
                    {item.id.startsWith("alert:") ? <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id,"accept")}>Reviewed</button> : !isEvent && item.accountEmail !== "ASS" ? <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id,"accept")}>Create task</button> : null}
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

      {drafts.length ? <section className="inbox-section"><div className="inbox-section-title"><span>Replies ready for review</span><small>{drafts.length}</small></div><div className="draft-list">{drafts.map((draft) => <article key={draft.id}><small>To {draft.recipient || "unknown recipient"}</small><h2>{draft.subject}</h2><textarea aria-label={`Draft reply for ${draft.subject}`} rows={7} value={draftBodies[draft.id] ?? draft.body} onChange={(event) => setDraftBodies((current) => ({ ...current, [draft.id]: event.target.value }))} /><div><button type="button" disabled={busy === `draft:${draft.id}`} onClick={() => void handleDraft(draft.id, "save")}>{busy === `draft:${draft.id}` ? "Saving…" : "Save to Gmail Drafts"}</button><button type="button" disabled={busy === `draft:${draft.id}`} onClick={() => void handleDraft(draft.id, "ignore")}>No response needed</button></div><em>ASS can create a draft, but it cannot send it.</em></article>)}</div></section> : null}

      <section className="inbox-section">
        <div className="inbox-section-title"><span>Files</span><small>{files.length}</small></div>
        {files.length === 0 ? (
          <div className="inbox-empty"><Inbox size={22} /><div><strong>Nothing waiting</strong><p>Import a syllabus, assignment, reading, dataset, or financial document.</p></div></div>
        ) : (
          <div className="file-list">
            {[...pendingFiles, ...files.filter((file) => !pendingFiles.includes(file))].map((file) => (
              <article key={file.id} className="file-card" onClickCapture={()=>window.sessionStorage.setItem("ass_selected_context",JSON.stringify({kind:"file",id:file.id,at:Date.now()}))} onFocusCapture={()=>window.sessionStorage.setItem("ass_selected_context",JSON.stringify({kind:"file",id:file.id,at:Date.now()}))}>
                <div className="file-card-heading">
                  {file.status === "failed" ? <AlertCircle size={20} /> : file.status === "extracted" ? <FileCheck2 size={20} /> : <FileText size={20} />}
                  <div><h2>{file.name}</h2><p>{human(file.classification)} · {fileSize(file.byte_size)} · {file.linked_course?.course_code || (file.linked_project_local_id ? `Project ${file.linked_project_local_id}` : "Unlinked")} · {file.last_analyzed_at ? `Analyzed ${new Date(file.last_analyzed_at).toLocaleDateString()}` : `Added ${new Date(file.created_at).toLocaleDateString()}`}</p></div>
                  <span className={`file-status is-${file.status}`}>{busy===`reanalyze:${file.id}`?"Re-analyzing":file.status==="extracted"?"Analyzed":human(file.status)}</span>
                </div>
                {file.processing_error ? <p className="file-failure">{file.processing_error}</p> : file.extraction?.summary ? <details className="analysis-understanding"><summary>Document understanding</summary><p className="file-summary">{file.extraction.summary}</p></details> : null}
                <button type="button" disabled={Boolean(busy)} onClick={() => void reanalyze(file.id,true)}>{busy === `reanalyze:${file.id}` ? "Re-analyzing…" : file.processing_error?"Retry analysis":"Re-analyze"}</button>
                <ExtractionReview items={file.items} busy={busy} conversionTypes={conversionTypes} onChange={(id,value)=>setConversionTypes(current=>({...current,[id]:value}))} onReview={(id,action,type)=>void review(id,action,type)} />
              </article>
            ))}
          </div>
        )}
      </section>

      {texts.length ? <section className="inbox-section">
        <div className="inbox-section-title"><span>Text imports</span><small>{texts.length}</small></div>
        <div className="file-list">{texts.map(source=><article key={source.id} className="file-card"
          onClickCapture={()=>window.sessionStorage.setItem("ass_selected_context",JSON.stringify({kind:"source",id:source.id,at:Date.now()}))}
          onFocusCapture={()=>window.sessionStorage.setItem("ass_selected_context",JSON.stringify({kind:"source",id:source.id,at:Date.now()}))}>
          <div className="file-card-heading"><FileText size={20}/><div><h2>{source.title}</h2><p>{human(source.source_type)}{source.last_analyzed_at?` · Analyzed ${new Date(source.last_analyzed_at).toLocaleString()}`:""}</p></div><span className={`file-status is-${source.processing_status}`}>{source.processing_status==="extracted"?"Analyzed":human(source.processing_status)}</span></div>
          {source.processing_error?<p className="file-failure" role="alert">{source.processing_error}</p>:source.extraction?.summary?<details className="analysis-understanding"><summary>Document understanding</summary><p className="file-summary">{source.extraction.summary}</p></details>:null}
          <button type="button" disabled={Boolean(busy)} onClick={()=>void reanalyze(source.id,false)}>{busy===`reanalyze:${source.id}`?"Re-analyzing…":source.processing_error?"Retry analysis":"Re-analyze"}</button>
          <ExtractionReview items={source.items} busy={busy} conversionTypes={conversionTypes} onChange={(id,value)=>setConversionTypes(current=>({...current,[id]:value}))} onReview={(id,action,type)=>void review(id,action,type)}/>
        </article>)}</div>
      </section>:null}
    </main>
  );
}
