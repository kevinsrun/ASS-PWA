import {
  EmailCalendarSuggestion,
  parseEmailCalendarSuggestion,
} from "@/lib/emailParser";
import { getGoogleAccessToken, readStoredGoogleToken } from "@/lib/googleAuth";

type GmailMessageList = {
  messages?: Array<{ id: string }>;
};

type GmailMessage = {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{
      name: string;
      value: string;
    }>;
  };
};

function getHeader(message: GmailMessage, name: string) {
  return (
    message.payload?.headers?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase()
    )?.value ?? ""
  );
}

async function gmailFetch<T>(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Gmail request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function scanRecentGmailSuggestions(userId: string) {
  if (!(await readStoredGoogleToken(userId))) {
    return { connected: false, suggestions: [] };
  }

  const accessToken = await getGoogleAccessToken(userId);
  const query = encodeURIComponent(
    'newer_than:45d (appointment OR meeting OR class OR exam OR event OR schedule OR due OR deadline OR "calendar invite")'
  );
  const list = await gmailFetch<GmailMessageList>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${query}`,
    accessToken
  );
  const messages = await Promise.all(
    (list.messages ?? []).map((message) =>
      gmailFetch<GmailMessage>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=Subject`,
        accessToken
      )
    )
  );
  const suggestions = messages
    .map((message) =>
      parseEmailCalendarSuggestion({
        id: message.id,
        subject: getHeader(message, "Subject"),
        snippet: message.snippet ?? "",
        internalDate: message.internalDate,
      })
    )
    .filter(
      (suggestion): suggestion is EmailCalendarSuggestion =>
        suggestion !== null
    );

  return {
    connected: true,
    suggestions,
  };
}
