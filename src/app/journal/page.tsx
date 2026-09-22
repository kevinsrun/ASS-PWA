"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "@/providers/AppProvider";

const moods = ["steady", "focused", "tired", "stressed", "excited"];

export default function JournalPage() {
  const { journals, addJournal, updateJournal, deleteJournal } = useAppContext();
  const [isComposing, setIsComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mood, setMood] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const draft = localStorage.getItem("ass_journal_draft");
    if (draft) setBody(draft);
  }, []);

  useEffect(() => {
    if (body) localStorage.setItem("ass_journal_draft", body);
    else localStorage.removeItem("ass_journal_draft");
  }, [body]);

  const entries = useMemo(() => [...journals]
    .filter((entry) => {
      const text = `${entry.title ?? ""} ${entry.content} ${entry.mood ?? ""} ${(entry.themes ?? []).join(" ")}`.toLowerCase();
      return text.includes(query.toLowerCase().trim());
    })
    .sort((a, b) => b.date.localeCompare(a.date)), [journals, query]);
  const selected = journals.find((entry) => entry.id === selectedId);

  function save() {
    if (!body.trim()) return;
    addJournal(body, { title: title.trim(), mood });
    setTitle(""); setBody(""); setMood(""); setIsComposing(false);
  }

  return (
    <main className="product-page journal-product">
      <header className="product-header journal-header">
        <div><p className="ass-kicker">A quiet place for your thoughts</p><h1>Journal</h1><p>{journals.length ? `${journals.length} ${journals.length === 1 ? "entry" : "entries"}` : "Start with a moment from today."}</p></div>
        <button type="button" className="ass-primary-button" onClick={() => setIsComposing(true)}>Write</button>
      </header>

      <div className="journal-tools">
        <label className="search-field"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entries" aria-label="Search journal entries" /></label>
        <button type="button" className="ass-secondary-button" onClick={() => setQuery("")}>All entries</button>
      </div>

      {isComposing && <section className="journal-composer" aria-labelledby="composer-title">
        <div className="composer-top"><div><p className="ass-kicker">New entry</p><h2 id="composer-title">What is on your mind?</h2></div><button type="button" className="quiet-action" onClick={() => setIsComposing(false)} aria-label="Close composer">Close</button></div>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (optional)" className="journal-title-input" />
        <textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write freely…" className="journal-composer-input" />
        <div className="composer-bottom"><div className="mood-picker" aria-label="Mood">{moods.map((option) => <button type="button" key={option} onClick={() => setMood(mood === option ? "" : option)} className={mood === option ? "selected" : ""}>{option}</button>)}</div><button type="button" className="ass-primary-button" onClick={save} disabled={!body.trim()}>Save</button></div>
      </section>}

      <section className="journal-feed" aria-label="Journal entries">
        {entries.map((entry) => <article className="journal-entry-card" key={entry.id}>
          <button type="button" className="journal-entry-open" onClick={() => setSelectedId(entry.id)}>
            <time>{new Date(`${entry.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</time>
            {entry.title && <h2>{entry.title}</h2>}
            <p>{entry.content}</p>
            <span className="journal-entry-meta">{entry.mood || "Entry"}{entry.themes?.length ? ` · ${entry.themes.join(" · ")}` : ""}</span>
          </button>
          <button type="button" className="quiet-action is-destructive journal-delete" onClick={() => deleteJournal(entry.id)} aria-label="Delete journal entry">Delete</button>
        </article>)}
        {!entries.length && <div className="quiet-empty"><strong>Start your journal</strong><span>Capture a thought, a moment, or a detail worth remembering.</span><button type="button" className="ass-primary-button" onClick={() => setIsComposing(true)}>Write your first entry</button></div>}
      </section>

      {selected && <div className="journal-detail-backdrop" role="presentation" onClick={() => setSelectedId(null)}><article className="journal-detail" role="dialog" aria-modal="true" aria-labelledby="entry-detail-title" onClick={(event) => event.stopPropagation()}><div className="composer-top"><time>{selected.date}</time><button type="button" className="quiet-action" onClick={() => setSelectedId(null)}>Close</button></div><input id="entry-detail-title" value={selected.title ?? ""} onChange={(event) => updateJournal(selected.id, { title: event.target.value })} placeholder="Untitled entry" className="journal-title-input" /><textarea value={selected.content} onChange={(event) => updateJournal(selected.id, { content: event.target.value })} className="journal-composer-input detail-input" /></article></div>}
    </main>
  );
}
