import { describe, expect, it } from "vitest";
import { evaluateDeployment, type HyperDeployInput } from "../src/hyper-deploy";

const digest = `sha256:${"a".repeat(64)}`;
const priorDigest = `sha256:${"b".repeat(64)}`;

const previewInput: HyperDeployInput = {
  planId: "plan-11",
  targetEnvironment: "preview",
  release: { releaseId: "release-11", digest },
  artifactEvidence: { status: "verified", artifactId: "artifact-11", digest, verifier: "builder-1" },
  gateEvidence: [
    { gateId: "tests", status: "verified", verifier: "ci-1" },
    { gateId: "security", status: "verified", verifier: "scanner-1" },
  ],
  previewUrlEvidence: { status: "verified", url: "https://preview.example.test/releases/11", verifier: "observer-1" },
};

describe("evaluateDeployment", () => {
  it("verifies a preview plan deterministically without mutating evidence", () => {
    const first = evaluateDeployment(previewInput);
    const second = evaluateDeployment(previewInput);

    expect(first).toEqual(second);
    expect(first.outcome).toBe("verified");
    expect(first.plan?.verifiedGates).toEqual(["security", "tests"]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.plan?.verifiedGates)).toBe(true);
    expect(previewInput.gateEvidence?.map((gate) => gate.gateId)).toEqual(["tests", "security"]);
  });

  it("requires verified human approval for production", () => {
    const result = evaluateDeployment({
      ...previewInput,
      targetEnvironment: "production",
      humanApproval: { status: "verified", approverId: "human-1", actorKind: "human", releaseId: "release-11" },
    });

    expect(result.outcome).toBe("verified");
    expect(result.plan?.approvedBy).toBe("human-1");
  });

  it("blocks when required external evidence is missing", () => {
    expect(evaluateDeployment({ ...previewInput, artifactEvidence: undefined })).toEqual({
      outcome: "blocked",
      reasons: ["artifact_evidence_missing"],
    });
    expect(evaluateDeployment({ ...previewInput, targetEnvironment: "production" })).toEqual({
      outcome: "blocked",
      reasons: ["human_approval_missing"],
    });
  });

  it("rejects failed evidence and produces no plan", () => {
    const result = evaluateDeployment({
      ...previewInput,
      gateEvidence: [{ gateId: "tests", status: "failed", verifier: "ci-1" }],
    });

    expect(result).toEqual({ outcome: "rejected", reasons: ["gate_evidence_failed"] });
    expect(result.plan).toBeUndefined();
  });

  it("rejects credential-like keys or values without echoing them", () => {
    const secret = "Bearer very-sensitive-token";
    const result = evaluateDeployment({ ...previewInput, api_token: secret } as HyperDeployInput);
    const valueResult = evaluateDeployment({
      ...previewInput,
      previewUrlEvidence: { ...previewInput.previewUrlEvidence!, verifier: secret },
    });

    expect(result).toEqual({ outcome: "rejected", reasons: ["credential_like_data_forbidden"] });
    expect(valueResult.reasons.join(" ")).not.toContain(secret);
    expect(valueResult.outcome).toBe("rejected");
  });

  it("rejects preview URLs containing username or password credentials", () => {
    for (const url of [
      "https://user@preview.example.test/releases/11",
      "https://user:password@preview.example.test/releases/11",
    ]) {
      expect(evaluateDeployment({
        ...previewInput,
        previewUrlEvidence: { ...previewInput.previewUrlEvidence!, url },
      })).toEqual({
        outcome: "rejected",
        reasons: ["preview_url_evidence_invalid"],
      });
    }
  });

  it("rejects preview URLs containing query strings or fragments", () => {
    for (const url of [
      "https://preview.example.test/releases/11?signature=opaque",
      "https://preview.example.test/releases/11#deployment-details",
    ]) {
      expect(evaluateDeployment({
        ...previewInput,
        previewUrlEvidence: { ...previewInput.previewUrlEvidence!, url },
      })).toEqual({
        outcome: "rejected",
        reasons: ["preview_url_evidence_invalid"],
      });
    }
  });

  it("creates an immutable rollback manifest from a distinct prior release", () => {
    const result = evaluateDeployment({
      ...previewInput,
      priorRelease: { releaseId: "release-10", digest: priorDigest },
    });

    expect(result.plan?.rollback).toEqual({
      kind: "rollback_manifest",
      targetEnvironment: "preview",
      fromReleaseId: "release-11",
      fromDigest: digest,
      toReleaseId: "release-10",
      toDigest: priorDigest,
    });
    expect(Object.isFrozen(result.plan?.rollback)).toBe(true);
  });
});
