import { describe, expect, it } from "vitest";
import { planSynthVoice, type SynthVoiceInput } from "../src/synth-voice";

const valid: SynthVoiceInput = {
  text: "Welcome, traveler, to the clockwork garden.",
  profile: { id: "garden-guide", subject: "fictional", displayName: "Garden Guide", description: "An original, warm mechanical narrator." },
  evidence: { provenanceDigest: "a".repeat(64), provenanceVerified: true, licenseId: "cc0-original", licenseVerified: true, realPersonPermissionVerified: false, textRightsVerified: true },
  effects: [{ kind: "emphasis", amount: 0.4 }, { kind: "pause", amount: 0.2 }],
  rate: 1, pitch: 0, volume: 0.8,
  unsafeContent: false, containsPii: false, containsSecret: false, copyrightedLongForm: false,
  accessibility: { captions: true, transcript: true, reduceEffects: false },
};

describe("planSynthVoice", () => {
  it("plans a fictional voice without synthesizing audio", () => {
    const result = planSynthVoice(valid);
    expect(result).toEqual({ outcome: "verified", reasons: [], plan: {
      profileId: "garden-guide", text: valid.text, rate: 1, pitch: 0, volume: 0.8,
      effects: valid.effects, captions: true, transcript: true, notices: [],
    }});
    expect(result.plan).not.toHaveProperty("audio");
  });

  it("rejects identifiable-person imitation without verified permission", () => {
    const result = planSynthVoice({ ...valid, profile: { ...valid.profile, subject: "identifiable_real_person" } });
    expect(result).toEqual({ outcome: "rejected", reasons: ["real_person_permission_required"] });
    expect(result.plan).toBeUndefined();
    expect(planSynthVoice({ ...valid, profile: { ...valid.profile, subject: "identifiable_real_person" }, evidence: { ...valid.evidence, realPersonPermissionVerified: true } }).outcome).toBe("verified");
  });

  it("rejects missing or failed provenance, licensing, and text-rights evidence", () => {
    expect(planSynthVoice({ ...valid, evidence: { ...valid.evidence, provenanceVerified: false, licenseVerified: false, textRightsVerified: false } })).toEqual({
      outcome: "rejected", reasons: ["license_not_verified", "provenance_not_verified", "text_rights_not_verified"],
    });
  });

  it("rejects unsafe, private, secret, and copyrighted long-form content", () => {
    expect(planSynthVoice({ ...valid, unsafeContent: true }).reasons).toContain("unsafe_content");
    expect(planSynthVoice({ ...valid, text: "Contact person@example.com" }).reasons).toContain("pii_content");
    expect(planSynthVoice({ ...valid, text: "api_key=do-not-speak" }).reasons).toContain("secret_content");
    expect(planSynthVoice({ ...valid, copyrightedLongForm: true }).reasons).toContain("copyrighted_long_form");
  });

  it("enforces text, profile, effect, rate, pitch, and volume bounds", () => {
    expect(planSynthVoice({ ...valid, text: "x".repeat(4_001) }).reasons).toContain("invalid_or_unbounded_text");
    expect(planSynthVoice({ ...valid, profile: { ...valid.profile, description: "x".repeat(513) } }).reasons).toContain("invalid_or_unbounded_profile");
    expect(planSynthVoice({ ...valid, effects: Array.from({ length: 17 }, () => ({ kind: "pause" as const, amount: 0.2 })) }).reasons).toContain("invalid_or_unbounded_effects");
    expect(planSynthVoice({ ...valid, rate: 2.01, pitch: 13, volume: 1.1 }).reasons).toContain("invalid_audio_parameters");
  });

  it("rejects whitespace-only fields and unknown runtime subject values without rewriting text", () => {
    expect(planSynthVoice({ ...valid, text: " \n\t " }).reasons).toContain("invalid_or_unbounded_text");
    expect(planSynthVoice({ ...valid, profile: { ...valid.profile, displayName: "   " } }).reasons).toContain("invalid_or_unbounded_profile");
    expect(planSynthVoice({ ...valid, profile: { ...valid.profile, description: "\n\t" } }).reasons).toContain("invalid_or_unbounded_profile");
    const unknownSubject = { ...valid.profile, subject: "celebrity" as SynthVoiceInput["profile"]["subject"] };
    expect(planSynthVoice({ ...valid, profile: unknownSubject }).reasons).toContain("invalid_or_unbounded_profile");
    const spaced = { ...valid, text: "  Keep my intentional spacing.  " };
    expect(planSynthVoice(spaced).plan?.text).toBe(spaced.text);
  });

  it("requires captions or a transcript for every verified plan", () => {
    const result = planSynthVoice({ ...valid, accessibility: { captions: false, transcript: false, reduceEffects: false } });
    expect(result).toEqual({ outcome: "rejected", reasons: ["accessibility_output_missing"] });
    expect(result.plan).toBeUndefined();
    expect(planSynthVoice({ ...valid, accessibility: { captions: false, transcript: true, reduceEffects: false } }).outcome).toBe("verified");
  });

  it("applies reduced-effects accessibility and preserves caption settings", () => {
    const result = planSynthVoice({ ...valid, accessibility: { captions: true, transcript: false, reduceEffects: true } });
    expect(result.plan?.effects).toEqual([{ kind: "pause", amount: 0.2 }]);
    expect(result.plan?.notices).toEqual(["effects_reduced_for_accessibility"]);
    expect(result.plan?.captions).toBe(true);
    expect(result.plan?.transcript).toBe(false);
  });

  it("is deterministic and does not mutate caller input", () => {
    const input = structuredClone(valid);
    const snapshot = structuredClone(input);
    expect(planSynthVoice(input)).toEqual(planSynthVoice(input));
    expect(input).toEqual(snapshot);
    expect(planSynthVoice(input).plan?.effects).not.toBe(input.effects);
  });
});
