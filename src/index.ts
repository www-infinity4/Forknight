import { ChronoRelayDurableObject } from "./chrono-relay";
import { planResearchJob, transitionResearchJob } from "./aether-scout";
import { evaluateExtraction } from "./xenon-harvester";
import {
  parseAppend, parseExtractionManifest, parseResearchJob, readJsonBounded
} from "./validation";
import type { ResearchStatus } from "./types";

export { ChronoRelayDurableObject };

function json(outcome: "verified" | "rejected" | "blocked", details: Record<string, unknown>, status = 200): Response {
  return Response.json({ outcome, ...details }, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/relay/events") {
        const event = parseAppend(await readJsonBounded(request));
        const id = env.CHRONO_RELAY.idFromName(event.streamId);
        return env.CHRONO_RELAY.get(id).fetch(new Request("https://relay/append", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event)
        }));
      }
      if (request.method === "GET" && url.pathname === "/relay/events") {
        const streamId = url.searchParams.get("streamId");
        if (!streamId) return json("rejected", { error: "streamId-required" }, 400);
        const query = new URLSearchParams();
        if (url.searchParams.has("cursor")) query.set("cursor", url.searchParams.get("cursor") ?? "");
        if (url.searchParams.has("limit")) query.set("limit", url.searchParams.get("limit") ?? "");
        const id = env.CHRONO_RELAY.idFromName(streamId);
        return env.CHRONO_RELAY.get(id).fetch("https://relay/events?" + query);
      }
      if (request.method === "POST" && url.pathname === "/scout/jobs") {
        return json("verified", { job: planResearchJob(parseResearchJob(await readJsonBounded(request))) }, 201);
      }
      if (request.method === "POST" && url.pathname === "/scout/transition") {
        const value = await readJsonBounded(request);
        if (typeof value !== "object" || value === null) throw new Error("transition-object-required");
        const input = value as Record<string, unknown>;
        const job = parseResearchJob(input.job);
        return json("verified", { job: transitionResearchJob(job, input.next as ResearchStatus) });
      }
      if (request.method === "POST" && url.pathname === "/harvester/evaluate") {
        return json("verified", evaluateExtraction(parseExtractionManifest(await readJsonBounded(request))) as unknown as Record<string, unknown>);
      }
      return json("rejected", { error: "not-found" }, 404);
    } catch (error) {
      if (error instanceof Error && [
        "body-too-large","empty-body","invalid-json"
      ].includes(error.message)) {
        return json("rejected", { error: error.message }, 400);
      }
      if (error instanceof Error && !error.message.toLowerCase().includes("storage")) {
        return json("rejected", { error: error.message }, 400);
      }
      const incidentId = crypto.randomUUID();
      console.error(JSON.stringify({ incidentId, error: String(error) }));
      return json("blocked", { error: "infrastructure-fault", incidentId }, 503);
    }
  }
} satisfies ExportedHandler<Env>;
