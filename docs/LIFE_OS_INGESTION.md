# ASS ingestion architecture

## Product boundary

ASS has one owner identity and many connected sources. Google accounts, local files, future Drive files, Plaid institutions, and email messages are sources—not separate ASS users. Supabase `user_id` is the ownership boundary for every imported object and derived action.

## Unified pipeline

```text
Local upload / drag-and-drop / future Drive / email attachment
                              ↓
                 Private Supabase Storage
                              ↓
                 imported_files (source record)
                              ↓
             MIME-aware extraction + Gemini analysis
                              ↓
        file_extractions (immutable result + structured_data)
                              ↓
            extraction_items (reviewable proposed actions)
                     ↙                    ↘
          high-confidence required     Inbox approval
                     ↘                    ↙
               Todo / plan / assistant alert
```

The original file remains private in the `ass-imports` bucket. Analysis never mutates the source. Derived items carry confidence, review state, and links to committed entities so processing is traceable and idempotent.

## State model

- File: `uploaded → analyzing → needs_review | extracted | failed`
- Extraction item: `pending → approved → committed`, or `pending → rejected`
- Email action: `pending → going | maybe | not_going | added | ignored`
- A `maybe` event creates a low-priority tentative ASS plan. `going` and `add_to_calendar` use the existing Google Calendar write pipeline.

Only required assignments, deadlines, and tasks at or above 94% model confidence can commit automatically. Events, policies, ambiguous dates, and lower-confidence results always wait for review.

## File adapters

- Plain text, Markdown, and CSV: decoded locally, then sent as bounded text.
- DOCX, XLSX, and PPTX: OOXML text is extracted server-side before analysis.
- PDF and images: sent to Gemini as inline file data.
- Google Drive: reserved as a future source adapter feeding the same storage and analysis boundary; it should not create a second extraction implementation.

## Data responsibilities

- `imported_files`: provenance, storage location, processing state, linkage, checksum.
- `file_extractions`: model, classification, confidence, summary, structured output.
- `extraction_items`: granular review queue and committed entity linkage.
- `email_action_items`: normalized decision queue over existing `email_suggestions`.
- `event_decisions`: durable user decisions and tentative state across email/file sources.
- `finance_goals` and `financial_runway_snapshots`: planning targets and historical runway estimates.

All tables use row-level security. Browser clients can read only their own records; privileged ingestion writes use the server-only Supabase key after bearer-token user validation.

## Reliability and observability

- SHA-256 checksums prevent duplicate file imports.
- Stable local IDs make task/plan commitment idempotent.
- Upload and model failures are written to `imported_files.processing_error` and surfaced in Inbox.
- Service logs include the pipeline stage and file ID without file contents or tokens.
- The 25 MB limit is enforced in both the route and Storage bucket.

## Production follow-ups

- Move model work to a durable queue when upload volume grows; keep the same state machine.
- Add signed, short-lived download URLs only when an explicit file preview is introduced.
- Add a Drive picker adapter with least-privilege scopes and copy imported bytes into the private bucket.
- Add malware scanning before analysis for untrusted shared files.
- Retention controls should delete the Storage object and cascade its derived database records together.
