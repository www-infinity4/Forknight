import type { Outcome } from "./types";

export type MediaRightsBasis = "licensed" | "public-domain" | "user-owned" | "authorized";
export type SceneUse = "accessibility" | "commentary" | "card-candidate" | "recommendation-signal";

export interface VisualObjectObservation {
  observationId: string;
  genericLabel: string;
  confidence: number;
  normalizedBox: readonly [number, number, number, number];
  attemptsPersonIdentification: boolean;
  containsSensitiveTraitInference: boolean;
}

export interface DialogueObservation {
  observationId: string;
  confidence: number;
  topicTags: string[];
  excerptCharacterCount: number;
}

export interface SceneObservationInput {
  sceneId: string;
  sourceMediaId: string;
  timestampMs: number;
  rightsBasis: MediaRightsBasis;
  provenanceDigest: string;
  requestedUses: SceneUse[];
  visualObjects: VisualObjectObservation[];
  dialogue: DialogueObservation[];
}

export interface NormalizedSceneObservation {
  sceneId: string;
  sourceMediaId: string;
  timestampMs: number;
  rightsBasis: MediaRightsBasis;
  requestedUses: SceneUse[];
  accessibilityLabels: Array<{ observationId: string; label: string; confidence: number }>;
  commentarySignals: string[];
  cardCandidateLabels: string[];
  recommendationTags: string[];
}

export interface SceneResult {
  outcome: Outcome;
  reasons: string[];
  scene?: NormalizedSceneObservation;
}

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_DIALOGUE_EXCERPT_CHARS = 90;

function validBox(box: readonly number[]): boolean {
  return box.length === 4 &&
    box.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    box[2] >= box[0] && box[3] >= box[1];
}

export function normalizeScene(input: SceneObservationInput): SceneResult {
  const reasons: string[] = [];
  if (!input.sceneId || !input.sourceMediaId) reasons.push("scene-and-media-id-required");
  if (!Number.isSafeInteger(input.timestampMs) || input.timestampMs < 0) reasons.push("invalid-timestamp");
  if (!SHA256.test(input.provenanceDigest)) reasons.push("invalid-provenance-digest");

  for (const object of input.visualObjects) {
    if (!object.observationId || !object.genericLabel) reasons.push("invalid-visual-observation");
    if (!Number.isFinite(object.confidence) || object.confidence < 0 || object.confidence > 1) {
      reasons.push("invalid-visual-confidence");
    }
    if (!validBox(object.normalizedBox)) reasons.push("invalid-normalized-box");
    if (object.attemptsPersonIdentification) reasons.push("person-identification-prohibited");
    if (object.containsSensitiveTraitInference) reasons.push("sensitive-trait-inference-prohibited");
  }

  for (const dialogue of input.dialogue) {
    if (!dialogue.observationId || !Number.isFinite(dialogue.confidence) ||
        dialogue.confidence < 0 || dialogue.confidence > 1) {
      reasons.push("invalid-dialogue-observation");
    }
    if (dialogue.excerptCharacterCount > MAX_DIALOGUE_EXCERPT_CHARS) {
      reasons.push("dialogue-excerpt-too-long");
    }
    if (dialogue.topicTags.some((tag) => !tag || tag.length > 40)) reasons.push("invalid-topic-tag");
  }

  if (reasons.length > 0) {
    return { outcome: "rejected", reasons: [...new Set(reasons)].sort() };
  }

  const labels = input.visualObjects
    .filter((object) => object.confidence >= 0.5)
    .map((object) => ({
      observationId: object.observationId,
      label: object.genericLabel,
      confidence: object.confidence
    }));

  const tags = [...new Set(input.dialogue.flatMap((item) => item.topicTags.map((tag) => tag.toLowerCase())))].sort();
  return {
    outcome: "verified",
    reasons: [],
    scene: {
      sceneId: input.sceneId,
      sourceMediaId: input.sourceMediaId,
      timestampMs: input.timestampMs,
      rightsBasis: input.rightsBasis,
      requestedUses: [...new Set(input.requestedUses)].sort(),
      accessibilityLabels: labels,
      commentarySignals: tags,
      cardCandidateLabels: labels.map((item) => item.label),
      recommendationTags: tags
    }
  };
}
