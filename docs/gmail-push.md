# Gmail push intelligence

ASS now accepts authenticated Pub/Sub notifications at:

`https://ass-pwa.vercel.app/api/gmail/push`

## Google Cloud activation (required)

Use **the Google Cloud project containing ASS's OAuth client**, not the
Supabase project or a new unrelated Cloud project. Google requires the watch
topic's project to match the OAuth client's project.

Run these in Google Cloud Shell after replacing `YOUR_PROJECT_ID`:

```sh
ASS_GCP_PROJECT=YOUR_PROJECT_ID
gcloud services enable pubsub.googleapis.com gmail.googleapis.com --project="$ASS_GCP_PROJECT"
gcloud pubsub topics create ass-gmail --project="$ASS_GCP_PROJECT"
gcloud pubsub topics add-iam-policy-binding ass-gmail --project="$ASS_GCP_PROJECT" --member=serviceAccount:gmail-api-push@system.gserviceaccount.com --role=roles/pubsub.publisher
gcloud iam service-accounts create ass-gmail-push --project="$ASS_GCP_PROJECT"
ASS_GCP_NUMBER=$(gcloud projects describe "$ASS_GCP_PROJECT" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "ass-gmail-push@$ASS_GCP_PROJECT.iam.gserviceaccount.com" --project="$ASS_GCP_PROJECT" --member="serviceAccount:service-$ASS_GCP_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" --role=roles/iam.serviceAccountTokenCreator
gcloud pubsub subscriptions create ass-gmail-push --project="$ASS_GCP_PROJECT" --topic=ass-gmail --push-endpoint=https://ass-pwa.vercel.app/api/gmail/push --push-auth-service-account="ass-gmail-push@$ASS_GCP_PROJECT.iam.gserviceaccount.com" --push-auth-token-audience=https://ass-pwa.vercel.app/api/gmail/push --ack-deadline=30
```

The operator also needs `iam.serviceAccounts.actAs` on the push service account.
Domain-restricted sharing may require an exception for Gmail's publishing
service account. Do not disable identity verification to work around IAM errors.
Existing topic/subscription resources should be inspected and updated, not duplicated.
No service-account JSON/private key needs to be copied into ASS.

Set these **Production** Vercel environment variables and redeploy:

```text
GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/ass-gmail
GMAIL_PUBSUB_SUBSCRIPTION=projects/YOUR_PROJECT_ID/subscriptions/ass-gmail-push
GMAIL_PUSH_SERVICE_ACCOUNT=ass-gmail-push@YOUR_PROJECT_ID.iam.gserviceaccount.com
GMAIL_PUSH_AUDIENCE=https://ass-pwa.vercel.app/api/gmail/push
```

The existing external cron renews each active account's watch daily (or when
expiration is within 48 hours). OAuth connection also attempts registration.
Run the authenticated maintenance endpoint below to register already connected
accounts immediately, without reconnecting them. It uses the same CRON_SECRET.

```text
POST /api/gmail/maintenance
Authorization: Bearer <CRON_SECRET>
```

## Delivery and recovery

Webhook validation checks Google's RS256 signature, issuer, expiration, audience,
verified service-account email, configured subscription, envelope size and string
history ID. History IDs are arbitrary-precision strings/numeric values, not JS
numbers. The webhook acknowledges **only after durable enqueue**. Unknown or
disconnected accounts are acknowledged without granting access or creating work.

`after()` starts a bounded worker after the response; inference is not inside the
acknowledgement. A database lease serializes ingestion, reanalysis and Gmail draft
export per account across all instances. Queue notifications deduplicate by
account/history ID. Out-of-order notifications cannot rewind the processed cursor.
The account cursor advances only after the entire discovered backlog is persisted;
notifications at/below that cursor then complete. Failed work stays pending with
backoff. A process crash expires its lease; cron drains pending work, even during
deep-planning quiet hours. Cron still performs incremental history reconciliation,
Calendar, Drive, finance and broken-object maintenance. No Vercel cron was added.

History pagination includes additions, labels and deletions. Label-only changes
update stored mailbox state without expensive inference. Deleted source messages
do not delete user-confirmed calendar events or drafts. Only an absent/expired
history cursor triggers a paginated seven-day safety recovery, with stable message
and destination identities preventing duplicates. Recovery older than seven days
is not guaranteed by this bounded initial-import policy.

## Intelligence and safety

Definite excluded mailbox states and non-actionable mailing-list announcements
use the cheap filter. Action signals override bulk heuristics; ambiguous/direct
mail gets Gemini. Existing corrections, personal rules, calendar, classes, tasks,
documents and style profiles are supplied as owned context. Extraction persists
multi-label classifications and separate response confidence/reason.

Replies require response confidence >= .90. ASS reads the bounded thread and only
approved, high-confidence user-written samples. Scheduling drafts append windows
checked by the existing deterministic recurring-event conflict engine; no model
availability arithmetic is used. Windows are proposals from the currently synced
ASS calendar, not guarantees against unsynchronized external events.

Drafts are saved **in ASS**, never sent or automatically exported to Gmail.
The existing Inbox Save to Gmail Drafts button calls `createGmailDraft()` and retains
account, thread, recipient and reply headers. A stored Gmail ID makes repeat saves
idempotent. Uncertain provider/database failures block blind duplicate export;
check Gmail Drafts and the error before recovery. Reanalysis never overwrites an
existing draft or a user-confirmed/ignored/manual-classified email.

High-confidence, evidence-backed deadlines create a task plus non-blocking deadline
marker. Confirmed events with no conflicts can create canonical events; optional
events become decisions even if no action is required. Conflicts require review.
Meeting-change interpretation must not silently move existing commitments.

## Diagnostics and verification

Inbox Email delivery details and `/debug/sync` show configuration, per-account
watch expiration/renewal, push receipt, processed cursor, last successful sync,
metrics, retries and errors. “Configured” does not claim successful delivery.

Run:

```sh
node scripts/verify-gmail-incremental.mjs
node scripts/verify-gmail-push.mjs
node scripts/verify-chat-agent.mjs
npm run lint
npm run build
```

After activation, send one test email to each connected account and check that a
real Pub/Sub receipt, incremental sync and the expected reviewable outcome appear.
Push delivery is not verified until this live test succeeds.

References: [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push),
[authenticated Pub/Sub push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions).
