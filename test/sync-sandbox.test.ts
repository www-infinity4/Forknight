import { describe, expect, it } from "vitest";
import { planSandboxSync, type SyncSandboxInput } from "../src/sync-sandbox";

const digest = "a".repeat(64);
const valid: SyncSandboxInput = {
  base: { revisionDigest: digest, values: { title: "Old", body: "Draft" } },
  authorizations: [
    { actorId: "human-1", authorized: true, evidence: "owner-approved" },
    { actorId: "bot-1", authorized: true, evidence: "scoped-grant" },
  ],
  operations: [
    { operationId: "op-1", actorId: "human-1", sequence: 1, key: "title", baseValue: "Old", value: "New" },
    { operationId: "op-2", actorId: "bot-1", sequence: 2, key: "body", baseValue: "Draft", value: "Ready" },
  ],
};

describe("planSandboxSync", () => {
  it("merges disjoint authorized edits in stable key order", () => {
    expect(planSandboxSync(valid)).toEqual({
      outcome: "verified", status: "merged", candidateState: { body: "Ready", title: "New" }, reasons: [],
    });
  });

  it("reports same-field competing edits without silently choosing a winner", () => {
    const result = planSandboxSync({
      ...valid,
      operations: [valid.operations[0]!, { ...valid.operations[1]!, key: "title", baseValue: "Old", value: "Other" }],
    });
    expect(result).toEqual({
      outcome: "verified", status: "conflicted",
      conflicts: [{ key: "title", operationIds: ["op-1", "op-2"], reason: "competing_edits" }],
      reasons: ["conflicts_require_resolution"],
    });
    expect(result.candidateState).toBeUndefined();
  });

  it("blocks missing evidence and rejects explicitly unauthorized actors", () => {
    expect(planSandboxSync({ ...valid, authorizations: valid.authorizations.filter((item) => item.actorId !== "bot-1") })).toEqual({
      outcome: "blocked", reasons: ["authorization_evidence_missing"],
    });
    expect(planSandboxSync({
      ...valid, authorizations: valid.authorizations.map((item) => item.actorId === "bot-1" ? { ...item, authorized: false } : item),
    })).toEqual({ outcome: "rejected", reasons: ["unauthorized_actor"] });
    expect(planSandboxSync({ ...valid, base: { ...valid.base, revisionDigest: "" } })).toEqual({
      outcome: "blocked", reasons: ["base_revision_evidence_missing"],
    });
  });

  it("rejects bad digests, duplicate IDs, and non-contiguous ordering", () => {
    const result = planSandboxSync({
      ...valid, base: { ...valid.base, revisionDigest: "bad" },
      operations: [valid.operations[0]!, { ...valid.operations[1]!, operationId: "op-1", sequence: 3 }],
    });
    expect(result).toEqual({ outcome: "rejected", reasons: ["conflicting_operation_id", "invalid_base_revision_digest", "out_of_order_sequence"] });
  });

  it("rejects operations supplied out of sequence", () => {
    expect(planSandboxSync({ ...valid, operations: [...valid.operations].reverse() })).toEqual({
      outcome: "rejected", reasons: ["out_of_order_sequence"],
    });
  });

  it("rejects obvious PII and secrets without echoing them", () => {
    const secret = "password=do-not-echo";
    const result = planSandboxSync({
      ...valid,
      base: { ...valid.base, values: { title: "owner@example.com" } },
      authorizations: valid.authorizations.map((item) => item.actorId === "human-1"
        ? { ...item, evidence: "Bearer abc.secret-token" } : item),
      operations: valid.operations.map((operation) => operation.operationId === "op-1"
        ? { ...operation, baseValue: secret, value: "api_key=hidden" } : operation),
    });
    expect(result.outcome).toBe("rejected");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "private_authorization_evidence", "private_operation_text", "private_state_text",
    ]));
    expect(result.reasons.join(" ")).not.toContain("do-not-echo");
    expect(result.candidateState).toBeUndefined();
  });

  it("reports stale base observations explicitly", () => {
    expect(planSandboxSync({ ...valid, operations: [{ ...valid.operations[0]!, baseValue: "Stale" }] })).toEqual({
      outcome: "verified", status: "conflicted",
      conflicts: [{ key: "title", operationIds: ["op-1"], reason: "base_value_mismatch" }],
      reasons: ["conflicts_require_resolution"],
    });
  });

  it("is deterministic and preserves the caller's input", () => {
    const input = structuredClone(valid);
    const snapshot = structuredClone(input);
    expect(planSandboxSync(input)).toEqual(planSandboxSync(structuredClone(input)));
    expect(input).toEqual(snapshot);
  });
});
