# Google Cloud Pub/Sub Production Configuration & DLQ Specification

## 1. Context & Invariant

When database persistence fails or the persistence circuit breaker is open, `/api/gmail/push` returns `HTTP 503` with a `Retry-After` header. This ensures ASS **never** returns `HTTP 200/202` on in-memory or unpersisted notification data:

> **Durability Invariant**: A Gmail push notification may ONLY be acknowledged (HTTP 2xx) if the minimal notification state is durably enqueued in PostgreSQL. If persistence is unavailable, the push request returns a retryable error (HTTP 503), delegating durable redelivery ownership to Google Cloud Pub/Sub. Authenticated malformed messages are deterministically acknowledged and dropped (HTTP 200 with `{ dropped: true }`) so poison messages never loop indefinitely.

To prevent retry storms and infinite delivery loops while Supabase is recovering, Google Cloud Pub/Sub must be configured with:
1. **Exponential Backoff Retry Policy** (minimum 10 seconds, maximum 600 seconds).
2. **Dead Letter Topic (DLQ)** to capture notifications that exceed delivery limits (5 attempts).
3. **Cloud Monitoring Alert** on DLQ unacked message count.

---

## 2. Infrastructure Setup (Google Cloud Shell / CLI)

Execute in the Google Cloud Project containing ASS's OAuth Client (`YOUR_PROJECT_ID`):

```sh
ASS_GCP_PROJECT="YOUR_PROJECT_ID"
ASS_GCP_NUMBER=$(gcloud projects describe "$ASS_GCP_PROJECT" --format='value(projectNumber)')

# 1. Create Dead Letter Topic (DLQ)
gcloud pubsub topics create ass-gmail-dlq --project="$ASS_GCP_PROJECT"

# 2. Create Pull Subscription on DLQ for operator inspection and replay
gcloud pubsub subscriptions create ass-gmail-dlq-sub \
  --project="$ASS_GCP_PROJECT" \
  --topic=ass-gmail-dlq \
  --message-retention-duration=7d

# 3. Grant Pub/Sub Service Agent Publisher permissions on the Dead Letter Topic
gcloud pubsub topics add-iam-policy-binding ass-gmail-dlq \
  --project="$ASS_GCP_PROJECT" \
  --member="serviceAccount:service-$ASS_GCP_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role=roles/pubsub.publisher

# 4. Grant Pub/Sub Service Agent Subscriber permissions on the Main Subscription
gcloud pubsub subscriptions add-iam-policy-binding ass-gmail-push \
  --project="$ASS_GCP_PROJECT" \
  --member="serviceAccount:service-$ASS_GCP_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role=roles/pubsub.subscriber

# 5. Update Existing Push Subscription with Bounded Retry Policy & Dead Letter Queue
gcloud pubsub subscriptions update ass-gmail-push \
  --project="$ASS_GCP_PROJECT" \
  --ack-deadline=30 \
  --min-retry-delay=10s \
  --max-retry-delay=600s \
  --dead-letter-topic=projects/"$ASS_GCP_PROJECT"/topics/ass-gmail-dlq \
  --max-delivery-attempts=5
```

If provisioning a fresh subscription from scratch:
```sh
gcloud pubsub subscriptions create ass-gmail-push \
  --project="$ASS_GCP_PROJECT" \
  --topic=ass-gmail \
  --push-endpoint=https://ass-pwa.vercel.app/api/gmail/push \
  --push-auth-service-account="ass-gmail-push@$ASS_GCP_PROJECT.iam.gserviceaccount.com" \
  --push-auth-token-audience=https://ass-pwa.vercel.app/api/gmail/push \
  --ack-deadline=30 \
  --min-retry-delay=10s \
  --max-retry-delay=600s \
  --dead-letter-topic=projects/"$ASS_GCP_PROJECT"/topics/ass-gmail-dlq \
  --max-delivery-attempts=5
```

---

## 3. Policy Specification

| Setting | Value | Rationale |
| :--- | :--- | :--- |
| `ack-deadline` | `30s` | ASS push endpoint responds in < 50ms; 30s provides ample network margin before Pub/Sub assumes instance timeout. |
| `min-retry-delay` | `10s` | Prevents tight retry loops when Supabase connection pool or rate limiter is saturated. Matches `Retry-After: 10`. |
| `max-retry-delay` | `600s` (10m) | Exponential backoff caps at 10 minutes to bound resource usage during extended outages. |
| `dead-letter-topic` | `ass-gmail-dlq` | Durable repository for notifications that failed delivery 5 consecutive times. |
| `max-delivery-attempts` | `5` | Allows transient network blips and brief DB maintenance to heal, but halts poison cascades after 5 attempts. |
| `message-retention-duration` | `7d` | Gives operators 7 days to inspect and replay DLQ messages. |

---

## 4. Operational Playbooks

### A. Inspecting Messages in the DLQ
To inspect messages routed to the dead letter subscription without acknowledging them:
```sh
gcloud pubsub subscriptions pull ass-gmail-dlq-sub \
  --project="YOUR_PROJECT_ID" \
  --limit=10 \
  --auto-ack=false
```

### B. Replaying DLQ Messages
After recovering database availability or resolving infrastructure issues, replay messages from the DLQ back to the primary topic:
```sh
# Fetch message payload and re-publish to primary topic
gcloud pubsub topics publish ass-gmail \
  --project="YOUR_PROJECT_ID" \
  --message="$(gcloud pubsub subscriptions pull ass-gmail-dlq-sub --project="YOUR_PROJECT_ID" --limit=1 --format='value(message.data)')"
```
Or use the official Pub/Sub dead-letter repair script or Cloud Console UI:
**Pub/Sub > Subscriptions > ass-gmail-dlq-sub > Messages > Replay**.

### C. Monitoring & Alerting
Create a Cloud Monitoring Alert Policy on metric `pubsub.googleapis.com/subscription/num_undelivered_messages`:
- **Filter**: `resource.labels.subscription_id = "ass-gmail-dlq-sub"`
- **Condition**: `num_undelivered_messages > 0` for 5 minutes
- **Notification**: PagerDuty / Operator Email
