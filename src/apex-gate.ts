import type { ExtractionDecision, Outcome } from "./types";

export type EvidenceState = "passed" | "failed" | "unavailable";

export interface CandidateArtifact {
  artifactId: string;
  digest: string;
  changedFiles: string[];
  tests: EvidenceState;
  typecheck: EvidenceState;
  securityReview: EvidenceState;
  licenseDecision: ExtractionDecision;
  unresolvedSecuritySeverities: Array<"low" | "medium" | "high" | "critical">;
  reviewerIds: string[];
  deploymentTarget: "none" | "preview" | "production";
}

export interface GateDecision {
  outcome: Outcome;
  reasons: string[];
}

const SHA256 = /^[0-9a-f]{64}$/;

export function evaluateCandidate(candidate: CandidateArtifact): GateDecision {
  const rejected: string[] = [];
  const blocked: string[] = [];

  if (!candidate.artifactId) rejected.push("artifact-id-required");
  if (!SHA256.test(candidate.digest)) rejected.push("invalid-artifact-digest");
  if (candidate.changedFiles.length === 0) rejected.push("changed-files-required");
  if (candidate.tests === "failed") rejected.push("tests-failed");
  if (candidate.typecheck === "failed") rejected.push("typecheck-failed");
  if (candidate.securityReview === "failed") rejected.push("security-review-failed");
  if (candidate.licenseDecision === "rejected") rejected.push("license-rejected");
  if (candidate.licenseDecision === "review-required") rejected.push("license-review-required");
  if (candidate.unresolvedSecuritySeverities.some((value) => value === "high" || value === "critical")) {
    rejected.push("high-severity-security-finding");
  }
  if (candidate.reviewerIds.length === 0) rejected.push("reviewer-required");

  if (candidate.tests === "unavailable") blocked.push("test-infrastructure-unavailable");
  if (candidate.typecheck === "unavailable") blocked.push("typecheck-infrastructure-unavailable");
  if (candidate.securityReview === "unavailable") blocked.push("security-review-infrastructure-unavailable");

  if (rejected.length > 0) return { outcome: "rejected", reasons: [...new Set(rejected)].sort() };
  if (blocked.length > 0) return { outcome: "blocked", reasons: [...new Set(blocked)].sort() };
  return { outcome: "verified", reasons: [] };
}
