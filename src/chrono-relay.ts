import type { AppendEventRequest, ConversationEvent } from "./types";

function eventKey(sequence: number): string {
  return "seq:" + sequence.toString().padStart(16, "0");
}

export async function canonicalDigest(input: Omit<AppendEventRequest, "provenanceDigest">): Promise<string> {
  const canonical = stableStringify(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const source = value as Record<string, unknown>;
  return "{" + Object.keys(source).sort().map((key) =>
    JSON.stringify(key) + ":" + stableStringify(source[key])
  ).join(",") + "}";
}

export class ChronoRelayDurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/append") {
      const body = await request.json<AppendEventRequest>();
      const material = {
        eventId: body.eventId, streamId: body.streamId, projectId: body.projectId,
        visibility: body.visibility, vectorTimestamp: body.vectorTimestamp, payload: body.payload
      };
      if (await canonicalDigest(material) !== body.provenanceDigest) {
        return Response.json({ outcome: "rejected", error: "provenance-digest-mismatch" }, { status: 400 });
      }

      const existingSequence = await this.state.storage.get<number>("id:" + body.eventId);
      if (existingSequence !== undefined) {
        const existing = await this.state.storage.get<ConversationEvent>(eventKey(existingSequence));
        return Response.json({ outcome: "verified", duplicate: true, event: existing });
      }

      const sequence = (await this.state.storage.get<number>("meta:sequence") ?? 0) + 1;
      const event: ConversationEvent = { ...body, sequence, createdAt: new Date().toISOString() };
      await this.state.storage.put({
        "meta:sequence": sequence,
        ["id:" + body.eventId]: sequence,
        [eventKey(sequence)]: event
      });
      return Response.json({ outcome: "verified", duplicate: false, event }, { status: 201 });
    }

    if (request.method === "GET" && url.pathname === "/events") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
      const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0));
      const entries = await this.state.storage.list<ConversationEvent>({
        startAfter: cursor ? eventKey(cursor) : undefined,
        prefix: "seq:",
        limit
      });
      const events = [...entries.values()];
      const nextCursor = events.length === limit ? events[events.length - 1]?.sequence ?? null : null;
      return Response.json({ outcome: "verified", events, nextCursor });
    }

    return Response.json({ outcome: "rejected", error: "not-found" }, { status: 404 });
  }
}
