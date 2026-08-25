import type {
  AppendEventRequest, ExtractionManifest, ResearchJob, ResearchStatus
} from "./types";

export const MAX_BODY_BYTES = 64 * 1024;
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_40 = /^[0-9a-f]{40}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function readJsonBounded(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BODY_BYTES) {
      throw new Error("body-too-large");
    }
  }

  if (!request.body) throw new Error("empty-body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("body-too-large");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.trim()) throw new Error("empty-body");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("invalid-json");
  }
}

export function parseAppend(value: unknown): AppendEventRequest {
  if (!record(value)) throw new Error("append-object-required");
  const visibility = value.visibility;
  if (typeof value.eventId !== "string" || !value.eventId) throw new Error("invalid-event-id");
  if (typeof value.streamId !== "string" || !value.streamId) throw new Error("invalid-stream-id");
  if (typeof value.projectId !== "string" || !value.projectId) throw new Error("invalid-project-id");
  if (!["public", "internal", "restricted"].includes(String(visibility))) throw new Error("invalid-visibility");
  if (!record(value.vectorTimestamp) ||
      Object.values(value.vectorTimestamp).some((n) => !Number.isSafeInteger(n) || Number(n) < 0)) {
    throw new Error("invalid-vector-timestamp");
  }
  if (!record(value.payload)) throw new Error("invalid-payload");
  if (typeof value.provenanceDigest !== "string" || !HEX_64.test(value.provenanceDigest)) {
    throw new Error("invalid-provenance-digest");
  }
  return value as unknown as AppendEventRequest;
}

export function parseResearchJob(value: unknown): ResearchJob {
  if (!record(value)) throw new Error("research-object-required");
  const statuses: ResearchStatus[] = ["queued","dispatched","synthesizing","completed","failed","rejected"];
  if (typeof value.jobId !== "string" || !value.jobId) throw new Error("invalid-job-id");
  if (typeof value.inquiry !== "string" || !value.inquiry) throw new Error("invalid-inquiry");
  if (!strings(value.allowedOrigins) || value.allowedOrigins.length < 1 || value.allowedOrigins.length > 20) {
    throw new Error("invalid-allowed-origins");
  }
  for (const origin of value.allowedOrigins) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("origin-must-be-https-origin");
    }
  }
  if (!Number.isSafeInteger(value.maxSources) || Number(value.maxSources) < 1 || Number(value.maxSources) > 50) {
    throw new Error("invalid-max-sources");
  }
  if (!Number.isSafeInteger(value.maxDepth) || Number(value.maxDepth) < 0 || Number(value.maxDepth) > 2) {
    throw new Error("invalid-max-depth");
  }
  if (!statuses.includes(value.status as ResearchStatus)) throw new Error("invalid-research-status");
  return value as unknown as ResearchJob;
}

export function parseExtractionManifest(value: unknown): ExtractionManifest {
  if (!record(value)) throw new Error("manifest-object-required");
  if (typeof value.manifestId !== "string" || !value.manifestId) throw new Error("invalid-manifest-id");
  if (typeof value.upstreamRepository !== "string") throw new Error("invalid-upstream-repository");
  const repo = new URL(value.upstreamRepository);
  if (repo.protocol !== "https:" || repo.hostname !== "github.com") throw new Error("unsupported-upstream");
  if (typeof value.exactCommit !== "string" || !HEX_40.test(value.exactCommit)) throw new Error("exact-commit-required");
  if (!strings(value.filesExamined) || value.filesExamined.length === 0) throw new Error("files-required");
  if (typeof value.feature !== "string" || !value.feature) throw new Error("feature-required");
  if (typeof value.detectedLicense !== "string" || !value.detectedLicense) throw new Error("license-required");
  if (!["reuse","adapt","clean-room"].includes(String(value.method))) throw new Error("invalid-method");
  if (!strings(value.attributionRequirements) || !strings(value.policyFlags)) throw new Error("invalid-policy-lists");
  return value as unknown as ExtractionManifest;
}
