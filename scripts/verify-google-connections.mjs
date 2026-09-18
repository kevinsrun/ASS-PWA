import {loadSourceModule as load} from "./load-source-module.mjs";
const db = load("@/lib/supabaseServer").getServiceSupabaseClient();
if (!db) throw new Error("Supabase server configuration missing");
const { data: owners, error } = await db
  .from("google_tokens")
  .select("user_id")
  .is("disconnected_at", null);
if (error) throw new Error(error.message);
const ids = [...new Set(owners.map((row) => row.user_id))];
const userId =
  process.env.ASS_TEST_USER_ID ?? (ids.length === 1 ? ids[0] : null);
if (!userId)
  throw new Error(
    "Set ASS_TEST_USER_ID to choose one owner; refusing an unscoped integration test",
  );
const health = await load("@/lib/googleServiceHealth").verifyGoogleServices(
  userId,
  undefined,
  true,
);
const auth = load("@/lib/googleAuth");
let failed = false;
for (const account of health) {
  let recentMessages = null,
    readFailure = null,
    metadataFetched = 0,
    refreshVerified = false,
    hasRefreshToken = false;
  try {
    const stored = await auth.readStoredGoogleToken(userId, account.id);
    hasRefreshToken = Boolean(stored?.refresh_token);
    const token = await auth.getGoogleAccessToken(userId, account.id, true);
    refreshVerified = true;
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=3",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(`Recent message list HTTP ${response.status}`);
    recentMessages = (data.messages ?? []).length;
    for (const message of data.messages ?? []) {
      const fetched = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=metadata`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!fetched.ok)
        throw new Error(`Message metadata HTTP ${fetched.status}`);
      await fetched.json();
      metadataFetched++;
    }
  } catch (error) {
    readFailure = error.message;
  }
  console.log(
    JSON.stringify({
      account: account.email,
      gmail: account.gmail,
      drive: account.drive,
      calendar: account.calendar,
      hasRefreshToken,
      refreshVerified,
      recentMessageIdsFetched: recentMessages,
      recentMessageMetadataFetched: metadataFetched,
      recentMessageError: readFailure,
    }),
  );
  if (
    account.gmail.state !== "connected" ||
    readFailure ||
    account.drive.state !== "connected"
  )
    failed = true;
}
if (!health.length) throw new Error("No connected accounts to verify");
if (process.argv.includes("--process")) {
  if (failed)
    throw new Error(
      "Gmail/Drive verification failed; refusing downstream processing",
    );
  for (const account of health) {
    const result = await load("@/lib/gmailScan").scanRecentGmailSuggestions(
      userId,
      account.id,
      undefined,
      5,
    );
    console.log(
      JSON.stringify({
        stage: "process-five-pending",
        account: account.email,
        emailsScanned: result.emailsScanned,
        actionsCreated: result.actionItemsCreated,
        draftsCreated: result.draftsCreated,
        eventsCreated: result.calendarEventsCreated,
        classifications: result.suggestions.map((item) => ({
          type: item.type,
          actionRequired: item.actionRequired,
        })),
        failures: result.failures,
      }),
    );
    if (result.failures.length) failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
