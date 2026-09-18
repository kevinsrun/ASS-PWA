// Fixed official sources only: user-controlled URLs never enter this fetch pipeline.
export const opportunitySources = [
  {
    key: "mit",
    name: "MIT",
    host: "calendar.mit.edu",
    endpoint: "https://calendar.mit.edu/api/2/events?days=30&pp=100",
  },
] as const;
export type PublicOpportunity = {
  source_key: string;
  source_id: string;
  source_url: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  virtual: boolean;
};
type LocalistEvent = {
  id?: string | number;
  title?: string;
  description_text?: string;
  localist_url?: string;
  location_name?: string;
  address?: string;
  experience?: string;
  event_instances?: {
    event_instance?: { id?: string | number; start?: string; end?: string };
  }[];
};
export function normalizeOfficialEvents(
  payload: unknown,
  source: (typeof opportunitySources)[number],
  now = Date.now(),
): PublicOpportunity[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { events?: unknown }).events)
  )
    throw new Error(`${source.name}: invalid official event feed`);
  const output = new Map<string, PublicOpportunity>();
  for (const wrapper of (
    payload as { events: { event?: LocalistEvent }[] }
  ).events.slice(0, 100)) {
    const event = wrapper?.event;
    if (
      !event?.id ||
      typeof event.title !== "string" ||
      typeof event.localist_url !== "string"
    )
      continue;
    let url: URL;
    try {
      url = new URL(event.localist_url);
    } catch {
      continue;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== source.host ||
      url.username ||
      url.password ||
      url.port
    )
      continue;
    for (const { event_instance: instance } of event.event_instances ?? []) {
      if (
        !instance?.start ||
        !Number.isFinite(Date.parse(instance.start)) ||
        Date.parse(instance.start) < now ||
        Date.parse(instance.start) > now + 31 * 86400000
      )
        continue;
      const id = `${event.id}:${instance.id ?? instance.start}`;
      output.set(id, {
        source_key: source.key,
        source_id: id,
        source_url: url.href,
        title: event.title.slice(0, 240),
        description: String(event.description_text ?? "").slice(0, 6000),
        starts_at: new Date(instance.start).toISOString(),
        ends_at:
          instance.end && Date.parse(instance.end) > Date.parse(instance.start)
            ? new Date(instance.end).toISOString()
            : null,
        location: String(
          event.location_name || event.address || "Location not specified",
        ).slice(0, 500),
        virtual: event.experience === "virtual",
      });
    }
  }
  return [...output.values()];
}
const categories = [
  ["research", /research|physics|biology|medicine|biotech|healthcare|surgery/i],
  ["career", /career|recruit|internship|scholarship|fellowship/i],
  [
    "technology",
    /artificial intelligence|machine learning|hackathon|engineering|startup|venture capital/i,
  ],
] as const;
export function rankOpportunity(
  event: PublicOpportunity,
  interests: string[],
  ignoredCategories: string[] = [],
) {
  const content = `${event.title} ${event.description}`;
  const category =
    categories.find(([, pattern]) => pattern.test(content))?.[0] ?? "general";
  // Only owned, explicitly stored interests count. No inferred biography or invented interests.
  const matches = interests
    .filter(
      (interest) =>
        interest.length >= 4 &&
        content.toLowerCase().includes(interest.toLowerCase()),
    )
    .slice(0, 3);
  const restricted =
    /open (?:only )?to all MIT|MIT (?:students|affiliates) only|must be an MIT|restricted to/i.test(
      content,
    );
  const relevance =
    restricted || ignoredCategories.includes(category) || !matches.length
      ? "low"
      : event.virtual
        ? "high"
        : "consider";
  return {
    category,
    relevance,
    reasons: matches.length
      ? matches.map((value) => `Matches your stored interest: ${value}`)
      : ["No explicit stored-interest match; not promoted automatically."],
    travel_note: event.virtual
      ? "Online; no travel needed."
      : "Travel and cost are not verified. For an MIT campus event, plan Providence–Cambridge travel before committing.",
    eligibility_note: restricted
      ? "Source mentions MIT affiliation requirements; verify eligibility before registering."
      : "Eligibility and registration availability require checking the official source.",
  };
}
export async function fetchOfficialOpportunities(
  source: (typeof opportunitySources)[number],
) {
  const response = await fetch(source.endpoint, {
    signal: AbortSignal.timeout(10000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
  // Bound decompressed response, including chunked feeds.
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${source.name}: empty response`);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4_000_000)
        throw new Error(`${source.name}: response exceeds limit`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return normalizeOfficialEvents(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
    source,
  );
}
