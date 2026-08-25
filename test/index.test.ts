import { describe, expect, it } from "vitest";
import { planResearchJob, transitionResearchJob } from "../src/aether-scout";
import { evaluateExtraction } from "../src/xenon-harvester";
import { MAX_BODY_BYTES, parseAppend, parseExtractionManifest, readJsonBounded } from "../src/validation";

const digest = "a".repeat(64);

describe("Forknight modules 1-3", () => {
  it("rejects malformed provenance digests", () => {
    expect(() => parseAppend({
      eventId:"e", streamId:"s", projectId:"p", visibility:"internal",
      vectorTimestamp:{a:1}, payload:{}, provenanceDigest:"bad"
    })).toThrow("invalid-provenance-digest");
  });

  it("rejects oversized streamed bodies", async () => {
    const request = new Request("https://test", {
      method:"POST", body:"x".repeat(MAX_BODY_BYTES + 1)
    });
    await expect(readJsonBounded(request)).rejects.toThrow("body-too-large");
  });

  it("rejects an invalid research transition", () => {
    const job = planResearchJob({
      jobId:"j", inquiry:"docs", allowedOrigins:["https://example.com/"],
      maxSources:3, maxDepth:1, status:"queued"
    });
    expect(() => transitionResearchJob(job, "completed")).toThrow("invalid-transition");
  });

  it("requires review instead of copying reciprocal code", () => {
    const manifest = parseExtractionManifest({
      manifestId:"m", upstreamRepository:"https://github.com/example/project",
      exactCommit:"b".repeat(40), filesExamined:["src/a.ts"], feature:"parser",
      detectedLicense:"AGPL-3.0", method:"clean-room",
      attributionRequirements:[], policyFlags:[]
    });
    expect(evaluateExtraction(manifest).decision).toBe("review-required");
  });

  it("rejects prohibited policy flags", () => {
    const manifest = parseExtractionManifest({
      manifestId:"m", upstreamRepository:"https://github.com/example/project",
      exactCommit:"c".repeat(40), filesExamined:["src/a.ts"], feature:"parser",
      detectedLicense:"MIT", method:"adapt",
      attributionRequirements:["Copyright holder"], policyFlags:["no-derivatives"]
    });
    expect(evaluateExtraction(manifest).decision).toBe("rejected");
  });
});
