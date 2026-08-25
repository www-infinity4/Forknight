import type { Outcome } from "./types";

export type VoiceSubject = "fictional" | "identifiable_real_person";

export interface VoiceProfile {
  readonly id: string;
  readonly subject: VoiceSubject;
  readonly displayName: string;
  readonly description: string;
}

export interface VoiceEvidence {
  readonly provenanceDigest: string;
  readonly provenanceVerified: boolean;
  readonly licenseId: string;
  readonly licenseVerified: boolean;
  readonly realPersonPermissionVerified: boolean;
  readonly textRightsVerified: boolean;
}

export interface SpeechEffect {
  readonly kind: "pause" | "emphasis" | "reverb";
  readonly amount: number;
}

export interface AccessibilitySettings {
  readonly captions: boolean;
  readonly transcript: boolean;
  readonly reduceEffects: boolean;
}

export interface SynthVoiceInput {
  readonly text: string;
  readonly profile: VoiceProfile;
  readonly evidence: VoiceEvidence;
  readonly effects: readonly SpeechEffect[];
  readonly rate: number;
  readonly pitch: number;
  readonly volume: number;
  /** Caller classification; true means the request must not be planned. */
  readonly unsafeContent: boolean;
  readonly containsPii: boolean;
  readonly containsSecret: boolean;
  readonly copyrightedLongForm: boolean;
  readonly accessibility: AccessibilitySettings;
}

export interface SpeechPlan {
  readonly profileId: string;
  readonly text: string;
  readonly rate: number;
  readonly pitch: number;
  readonly volume: number;
  readonly effects: readonly SpeechEffect[];
  readonly captions: boolean;
  readonly transcript: boolean;
  readonly notices: readonly string[];
}

export interface SynthVoiceResult {
  readonly outcome: Outcome;
  readonly reasons: readonly string[];
  readonly plan?: SpeechPlan;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SECRET = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?\d[\d ().-]{7,}\d)/;
const MAX_TEXT = 4_000;
const MAX_PROFILE_TEXT = 512;
const MAX_EFFECTS = 16;

function finiteBetween(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

/**
 * Produces a browser-agnostic plan from caller-supplied evidence. It never
 * performs synthesis, voice matching, I/O, model calls, or environment access.
 */
export function planSynthVoice(input: SynthVoiceInput): SynthVoiceResult {
  const invalid: string[] = [];
  if (input.text.trim().length === 0 || input.text.length > MAX_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)) invalid.push("invalid_or_unbounded_text");
  if (!ID.test(input.profile.id) || !["fictional", "identifiable_real_person"].includes(input.profile.subject) ||
      input.profile.displayName.trim().length === 0 || input.profile.displayName.length > 128 ||
      input.profile.description.trim().length === 0 || input.profile.description.length > MAX_PROFILE_TEXT) invalid.push("invalid_or_unbounded_profile");
  if (!ID.test(input.evidence.licenseId) || !DIGEST.test(input.evidence.provenanceDigest)) invalid.push("malformed_evidence");
  if (input.effects.length > MAX_EFFECTS || input.effects.some((effect) =>
    !["pause", "emphasis", "reverb"].includes(effect.kind) || !finiteBetween(effect.amount, 0, 1))) invalid.push("invalid_or_unbounded_effects");
  if (!finiteBetween(input.rate, 0.5, 2) || !finiteBetween(input.pitch, -12, 12) || !finiteBetween(input.volume, 0, 1)) invalid.push("invalid_audio_parameters");
  if (!input.accessibility.captions && !input.accessibility.transcript) invalid.push("accessibility_output_missing");
  if (invalid.length > 0) return { outcome: "rejected", reasons: [...new Set(invalid)].sort() };

  const prohibited: string[] = [];
  if (input.unsafeContent) prohibited.push("unsafe_content");
  if (input.containsPii || EMAIL.test(input.text) || PHONE.test(input.text)) prohibited.push("pii_content");
  if (input.containsSecret || SECRET.test(input.text)) prohibited.push("secret_content");
  if (input.copyrightedLongForm || (input.text.length > 1_000 && !input.evidence.textRightsVerified)) prohibited.push("copyrighted_long_form");
  if (input.profile.subject === "identifiable_real_person" && !input.evidence.realPersonPermissionVerified) prohibited.push("real_person_permission_required");
  if (prohibited.length > 0) return { outcome: "rejected", reasons: [...new Set(prohibited)].sort() };

  const failedEvidence: string[] = [];
  if (!input.evidence.provenanceVerified) failedEvidence.push("provenance_not_verified");
  if (!input.evidence.licenseVerified) failedEvidence.push("license_not_verified");
  if (!input.evidence.textRightsVerified) failedEvidence.push("text_rights_not_verified");
  if (failedEvidence.length > 0) return { outcome: "rejected", reasons: failedEvidence.sort() };

  const effects = input.accessibility.reduceEffects
    ? input.effects.filter((effect) => effect.kind === "pause").map((effect) => ({ ...effect }))
    : input.effects.map((effect) => ({ ...effect }));
  const notices = input.accessibility.reduceEffects && effects.length !== input.effects.length
    ? ["effects_reduced_for_accessibility"] : [];
  return {
    outcome: "verified",
    reasons: [],
    plan: {
      profileId: input.profile.id, text: input.text, rate: input.rate, pitch: input.pitch,
      volume: input.volume, effects, captions: input.accessibility.captions,
      transcript: input.accessibility.transcript, notices,
    },
  };
}
