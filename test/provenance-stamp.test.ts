import { describe, expect, it } from "vitest";
import { buildProvenanceStamp, type ProvenanceStampInput } from "../src/provenance-stamp";

const digest = (character: string): string => character.repeat(64);

const valid: ProvenanceStampInput = {
  artifactDigest: digest("a"),
  sourceReferences: [{ reference: "repo:src/module.ts", digest: digest("b"), evidenceAvailable: true }],
  contributors: [
    { id: "worker-2", kind: "worker" },
    { id: "model-1", kind: "model" },
  ],
  roles: [
    { actorId: "worker-2", role: "validator" },
    { actorId: "model-1", role: "generator" },
  ],
  reviews: [{ reviewerId: "reviewer-1", decision: "approved", evidenceDigest: digest("c"), evidenceAvailable: true }],
  licenses: [{ identifier: "MIT", approved: true, evidenceAvailable: true }],
  parentManifests: [{ manifestId: "parent-1", digest: digest("d"), evidenceAvailable: true }],
  manifestId: "manifest-12",
  timestamp: "2026-08-24T12:00:00Z",
};

describe("buildProvenanceStamp", () => {
  it("builds a structurally validated manifest without mutating input", () => {
    const snapshot = structuredClone(valid);
    const result = buildProvenanceStamp(valid);
    expect(result.outcome).toBe("verified");
    expect(result.manifest?.kind).toBe("structurally_validated_provenance_manifest");
    expect(valid).toEqual(snapshot);
  });

  it("is deterministic and stably sorts and deduplicates evidence", () => {
    const reversed: ProvenanceStampInput = {
      ...valid,
      contributors: [...valid.contributors, valid.contributors[0]!].reverse(),
      roles: [...valid.roles].reverse(),
      sourceReferences: [...valid.sourceReferences, valid.sourceReferences[0]!],
    };
    expect(buildProvenanceStamp(reversed)).toEqual(buildProvenanceStamp(valid));
    expect(buildProvenanceStamp(reversed).manifest?.contributors.map((item) => item.id)).toEqual(["model-1", "worker-2"]);
  });

  it("rejects conflicting duplicate identities while allowing exact duplicates", () => {
    expect(buildProvenanceStamp({
      ...valid,
      contributors: [...valid.contributors, { id: "model-1", kind: "worker" }],
      sourceReferences: [...valid.sourceReferences, { ...valid.sourceReferences[0]!, digest: digest("e") }],
      reviews: [...valid.reviews, { ...valid.reviews[0]!, decision: "rejected" }],
      licenses: [...valid.licenses, { ...valid.licenses[0]!, approved: false }],
      parentManifests: [...valid.parentManifests!, { ...valid.parentManifests![0]!, evidenceAvailable: false }],
    })).toEqual({
      outcome: "rejected",
      reasons: [
        "conflicting_contributor_identity",
        "conflicting_license_evidence",
        "conflicting_parent_manifest",
        "conflicting_reviewer_evidence",
        "conflicting_source_reference",
        "lineage_license_unapproved",
        "lineage_review_rejected",
      ],
    });

    const exactDuplicates: ProvenanceStampInput = {
      ...valid,
      contributors: [...valid.contributors, valid.contributors[0]!],
      roles: [...valid.roles, valid.roles[0]!],
      sourceReferences: [...valid.sourceReferences, valid.sourceReferences[0]!],
      reviews: [...valid.reviews, valid.reviews[0]!],
      licenses: [...valid.licenses, valid.licenses[0]!],
      parentManifests: [...valid.parentManifests!, valid.parentManifests![0]!],
    };
    expect(buildProvenanceStamp(exactDuplicates)).toEqual(buildProvenanceStamp(valid));
  });

  it("rejects malformed and uppercase SHA-256 strings", () => {
    expect(buildProvenanceStamp({ ...valid, artifactDigest: digest("A") })).toEqual({
      outcome: "rejected",
      reasons: ["invalid_artifact_digest"],
    });
  });

  it("rejects rejected reviews and unapproved licenses", () => {
    const result = buildProvenanceStamp({
      ...valid,
      reviews: [{ ...valid.reviews[0]!, decision: "rejected" }],
      licenses: [{ ...valid.licenses[0]!, approved: false }],
    });
    expect(result).toEqual({
      outcome: "rejected",
      reasons: ["lineage_license_unapproved", "lineage_review_rejected"],
    });
  });

  it("blocks when required evidence is unavailable", () => {
    const result = buildProvenanceStamp({
      ...valid,
      reviews: [{ ...valid.reviews[0]!, evidenceAvailable: false }],
    });
    expect(result).toEqual({ outcome: "blocked", reasons: ["review_evidence_unavailable"] });
  });

  it("rejects PII and secret-like values", () => {
    expect(buildProvenanceStamp({
      ...valid,
      contributors: [{ id: "person@example.com", kind: "human" }],
      roles: [{ actorId: "person@example.com", role: "author" }],
    }).reasons).toContain("invalid_or_private_contributor");

    expect(buildProvenanceStamp({
      ...valid,
      sourceReferences: [{ reference: "token=super-secret-value", digest: digest("b"), evidenceAvailable: true }],
    }).reasons).toContain("invalid_or_private_source_reference");
  });
});
