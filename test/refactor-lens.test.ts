import { describe, expect, it } from "vitest";
import { evaluateRefactors, type RefactorLensInput, type StaticCodeObservation } from "../src/refactor-lens";

const digest = `sha256:${"a".repeat(64)}`;
const base: StaticCodeObservation = {
  filePath: "src/service.ts", fileDigest: digest, rule: "large-function",
  evidence: "Function has 14 independent branches.", confidence: "confirmed", severity: "high",
  instruction: "Extract branch groups into named pure helpers and retain existing behavior.",
  sourceScope: "repository", license: "MIT", analyzerEvidence: true,
};

describe("evaluateRefactors", () => {
  it("ranks severity before confidence and emits instructions without rewriting code", () => {
    const result = evaluateRefactors({ observations: [
      { ...base, rule: "naming", severity: "low", confidence: "confirmed" },
      { ...base, rule: "cycle", severity: "critical", confidence: "suggested" },
      { ...base, rule: "duplication", severity: "critical", confidence: "confirmed" },
    ] });
    expect(result.outcome).toBe("verified");
    expect(result.findings?.map((item) => [item.rank, item.rule])).toEqual([[1, "duplication"], [2, "cycle"], [3, "naming"]]);
    expect(result.findings?.[0]).toHaveProperty("candidatePatchInstruction");
  });

  it("deduplicates identical evidence and sorts stable tie-breakers", () => {
    const other = { ...base, filePath: "src/a.ts", rule: "complexity" };
    const result = evaluateRefactors({ observations: [base, other, base] });
    expect(result.findings).toHaveLength(2);
    expect(result.findings?.map((item) => item.filePath)).toEqual(["src/a.ts", "src/service.ts"]);
  });

  it("rejects contradictory assessments for the same finding identity", () => {
    for (const contradictory of [
      { ...base, severity: "critical" as const },
      { ...base, confidence: "suggested" as const },
      { ...base, evidence: "A different analyzer result." },
      { ...base, instruction: "Use a different candidate refactor." },
    ]) {
      expect(evaluateRefactors({ observations: [base, contradictory] })).toEqual({
        outcome: "rejected", reasons: ["conflicting_duplicate_finding"],
      });
    }
  });

  it("blocks when analyzer evidence is absent", () => {
    expect(evaluateRefactors({ observations: [] })).toEqual({ outcome: "blocked", reasons: ["analyzer_evidence_unavailable"] });
    expect(evaluateRefactors({ observations: [{ ...base, analyzerEvidence: false }] })).toEqual({ outcome: "blocked", reasons: ["analyzer_evidence_unavailable"] });
  });

  it("rejects malformed data, unsupported scope, and missing provenance", () => {
    const result = evaluateRefactors({ observations: [{ ...base, fileDigest: "nope", rule: "BAD RULE", sourceScope: "internet" as never, license: "" }] });
    expect(result.outcome).toBe("rejected");
    expect(result.reasons).toEqual(["invalid_file_digest", "invalid_license", "invalid_rule", "unsupported_source_scope"]);
  });

  it("rejects private, secret, traversal, absolute, and unbounded values without echoing them", () => {
    const secret = "token=do-not-leak";
    const result = evaluateRefactors({ observations: [{ ...base, filePath: "../private.env", evidence: secret, instruction: "x".repeat(1_001) }] });
    expect(result.outcome).toBe("rejected");
    expect(result.reasons).toEqual(["invalid_or_private_evidence", "invalid_or_private_file_path", "invalid_or_private_instruction"]);
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
    expect(evaluateRefactors({ observations: [{ ...base, filePath: "/etc/passwd" }] }).outcome).toBe("rejected");
  });

  it("is deterministic and preserves caller input", () => {
    const input: RefactorLensInput = { observations: [base, { ...base, rule: "cycle", severity: "critical" }] };
    const snapshot = structuredClone(input);
    expect(evaluateRefactors({ observations: [...input.observations].reverse() })).toEqual(evaluateRefactors(input));
    expect(input).toEqual(snapshot);
  });

  it("bounds observation count", () => {
    expect(evaluateRefactors({ observations: Array.from({ length: 501 }, () => base) })).toEqual({ outcome: "rejected", reasons: ["too_many_observations"] });
  });
});
