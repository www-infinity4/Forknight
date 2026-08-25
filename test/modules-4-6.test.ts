import { describe, expect, it } from "vitest";
import { evaluateCandidate } from "../src/apex-gate";
import { normalizeScene } from "../src/nova-sight";
import { mapAudioMetrics } from "../src/sonic-forge";

const digest = "a".repeat(64);

describe("ApexGate", () => {
  const candidate = {
    artifactId: "artifact-1", digest, changedFiles: ["src/a.ts"],
    tests: "passed" as const, typecheck: "passed" as const,
    securityReview: "passed" as const, licenseDecision: "allowed" as const,
    unresolvedSecuritySeverities: [], reviewerIds: ["reviewer-1"],
    deploymentTarget: "preview" as const
  };

  it("verifies complete passing evidence", () => {
    expect(evaluateCandidate(candidate)).toEqual({ outcome: "verified", reasons: [] });
  });

  it("rejects known failures before unavailable infrastructure", () => {
    expect(evaluateCandidate({
      ...candidate, tests: "failed", securityReview: "unavailable"
    }).outcome).toBe("rejected");
  });

  it("blocks unavailable required evidence", () => {
    expect(evaluateCandidate({ ...candidate, tests: "unavailable" })).toEqual({
      outcome: "blocked", reasons: ["test-infrastructure-unavailable"]
    });
  });
});

describe("NovaSight", () => {
  const scene = {
    sceneId: "scene-1", sourceMediaId: "media-1", timestampMs: 1000,
    rightsBasis: "licensed" as const, provenanceDigest: digest,
    requestedUses: ["accessibility", "commentary"] as const,
    visualObjects: [{
      observationId: "object-1", genericLabel: "red bicycle", confidence: 0.9,
      normalizedBox: [0.1, 0.1, 0.5, 0.5] as const,
      attemptsPersonIdentification: false, containsSensitiveTraitInference: false
    }],
    dialogue: [{
      observationId: "dialogue-1", confidence: 0.8,
      topicTags: ["bicycle", "race"], excerptCharacterCount: 20
    }]
  };

  it("normalizes signals without reproducing dialogue", () => {
    const result = normalizeScene(scene);
    expect(result.outcome).toBe("verified");
    expect(result.scene?.recommendationTags).toEqual(["bicycle", "race"]);
  });

  it("rejects person identification and sensitive inference", () => {
    const result = normalizeScene({
      ...scene,
      visualObjects: [{
        ...scene.visualObjects[0],
        attemptsPersonIdentification: true,
        containsSensitiveTraitInference: true
      }]
    });
    expect(result.reasons).toContain("person-identification-prohibited");
    expect(result.reasons).toContain("sensitive-trait-inference-prohibited");
  });

  it("rejects long dialogue excerpts", () => {
    expect(normalizeScene({
      ...scene, dialogue: [{ ...scene.dialogue[0], excerptCharacterCount: 91 }]
    }).reasons).toContain("dialogue-excerpt-too-long");
  });
});

describe("SonicForge", () => {
  it("maps normalized metrics deterministically", () => {
    const first = mapAudioMetrics({ frequencyBins: [0.25, 0.75], rms: 0.5, peak: 0.8 });
    const second = mapAudioMetrics({ frequencyBins: [0.25, 0.75], rms: 0.5, peak: 0.8 });
    expect(first).toEqual(second);
    expect(first.parameters?.energy).toBe(0.5);
  });

  it("rejects non-finite and out-of-range metrics", () => {
    expect(mapAudioMetrics({ frequencyBins: [Number.NaN], rms: 0.5, peak: 0.8 }).outcome).toBe("rejected");
  });
});
