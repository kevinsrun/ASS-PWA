# Email automation checkpoint

Implemented in the existing Gmail push/history worker, under its existing
per-account database lease. No second scanner or background scheduler was added.

- A message is persisted as `processing` before inference. Failures are persisted
  as `failed` and retried without advancing its Gmail history cursor.
- Only after classification, drafts, and downstream actions are saved does the
  message become `processed`. Gmail label updates are a separate retry stage.
- Removing `UNREAD` requires actual `gmail.modify` authorization. Missing access
  is recorded as blocked, not as success. Existing accounts must reauthorize.
- Clear retail campaigns are suppressed; institutional and consequential
  correspondence is protected. Suppressed messages are retained and listed in
  Profile → Automation. No permanent Gmail deletion is implemented.
- Archiving is opt-in and only removes `INBOX` from high-confidence, unprotected
  retail marketing. Mark-as-read and archive retries are idempotent.
- Unsubscribe is opt-in, aggressive-mode only, requires three distinct explicit
  ignores, and accepts only a DKIM-bound RFC 8058 one-click HTTPS endpoint on the
  sender's own domain. Public DNS destinations are pinned for the request;
  redirects, cookies and OAuth authorization are never forwarded. Other links
  create a review suggestion instead. Completed/uncertain requests are not
  blindly replayed. Audit keys deduplicate per account/sender/list.
- The existing Gemini tool registry now exposes dotted namespace metadata and
  an availability/permissions tool. Stored-finance reads and the existing
  event-weather risk service are available, without money or schedule mutations.
- Automatic sending, form submission, and external-event deletion remain off.

Verification:

```sh
node scripts/verify-email-automation.mjs
node scripts/verify-email-unsubscribe.mjs
node scripts/verify-gmail-incremental.mjs
node scripts/verify-gmail-push.mjs
node scripts/verify-chat-agent.mjs
npm run build
```

This is **not completion of the entire expansion request**. External opportunity
discovery/ranking/registration reconciliation and the secure QR/form/profile
workflow remain to be implemented and tested. `ASS-iOS` contains a SwiftUI
scaffold, not a buildable Xcode target. Capability reporting explicitly marks
those workflows unavailable instead of pretending they exist.
