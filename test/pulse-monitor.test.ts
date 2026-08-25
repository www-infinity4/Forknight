import { describe, expect, it } from "vitest";
import { evaluatePulse, type PulseMonitorInput } from "../src/pulse-monitor";

const valid: PulseMonitorInput = {
  evaluatedAt: "2026-08-24T12:00:00Z",
  observations: [{ id: "worker-1", kind: "worker", status: "healthy", latencyMs: 20, queueDepth: 1, errorCount: 0, observedAt: "2026-08-24T11:59:30Z", evidenceAvailable: true }],
  capabilities: [
    { subjectId: "worker-1", capability: "filter", operational: true, evidenceAvailable: true },
    { subjectId: "worker-1", capability: "plugin", operational: true, evidenceAvailable: true },
    { subjectId: "worker-1", capability: "wallet", operational: true, evidenceAvailable: true },
  ],
  requiredCapabilities: ["wallet", "plugin", "filter"],
  thresholds: { warningLatencyMs: 100, criticalLatencyMs: 500, warningQueueDepth: 10, criticalQueueDepth: 50, warningErrorCount: 1, criticalErrorCount: 5, maxObservationAgeMs: 60_000 },
};

describe("evaluatePulse", () => {
  it("returns green only for complete passing evidence and reports capability coverage", () => {
    expect(evaluatePulse(valid)).toEqual({
      outcome: "verified", light: "green", reasons: ["green:worker-1:complete_passing_evidence"],
      coverage: [{ subjectId: "worker-1", operational: ["filter", "plugin", "wallet"], missing: [], unknown: [] }],
    });
  });

  it("returns yellow for degraded, stale, warning, or incomplete evidence", () => {
    const result = evaluatePulse({
      ...valid,
      observations: [{ ...valid.observations[0]!, status: "degraded", latencyMs: 100, observedAt: "2026-08-24T11:58:00Z", evidenceAvailable: false }],
      capabilities: valid.capabilities.filter((item) => item.capability !== "wallet"),
    });
    expect(result.outcome).toBe("verified");
    expect(result.light).toBe("yellow");
    expect(result.reasons).toEqual([
      "yellow:worker-1:capability_wallet_evidence_unavailable", "yellow:worker-1:health_evidence_unavailable",
      "yellow:worker-1:latency_warning", "yellow:worker-1:observation_stale", "yellow:worker-1:status_degraded",
    ]);
  });

  it("returns red for failed health, critical thresholds, and proven missing capabilities", () => {
    const result = evaluatePulse({
      ...valid,
      observations: [{ ...valid.observations[0]!, status: "failed", errorCount: 5 }],
      capabilities: valid.capabilities.map((item) => item.capability === "wallet" ? { ...item, operational: false } : item),
    });
    expect(result.light).toBe("red");
    expect(result.reasons).toContain("red:worker-1:status_failed");
    expect(result.reasons).toContain("red:worker-1:error_count_critical");
    expect(result.reasons).toContain("red:worker-1:capability_wallet_not_operational");
  });

  it("uses inclusive warning and critical boundaries", () => {
    expect(evaluatePulse({ ...valid, observations: [{ ...valid.observations[0]!, queueDepth: 10 }] }).light).toBe("yellow");
    expect(evaluatePulse({ ...valid, observations: [{ ...valid.observations[0]!, queueDepth: 50 }] }).light).toBe("red");
  });

  it("blocks instead of producing a vacuous light without health or required-capability evidence", () => {
    expect(evaluatePulse({ ...valid, observations: [] })).toEqual({
      outcome: "blocked", reasons: ["health_evidence_unavailable"],
    });
    expect(evaluatePulse({ ...valid, requiredCapabilities: [] })).toEqual({
      outcome: "blocked", reasons: ["required_capability_evidence_unavailable"],
    });
    expect(evaluatePulse({ ...valid, observations: [], requiredCapabilities: [] })).toEqual({
      outcome: "blocked", reasons: ["health_evidence_unavailable", "required_capability_evidence_unavailable"],
    });
  });

  it("rejects input collections above their bounds", () => {
    const observation = valid.observations[0]!;
    const capability = valid.capabilities[0]!;
    expect(evaluatePulse({ ...valid, observations: Array.from({ length: 1_001 }, (_, index) => ({ ...observation, id: `worker-${index}` })) }).reasons)
      .toContain("too_many_observations");
    expect(evaluatePulse({ ...valid, capabilities: Array.from({ length: 10_001 }, () => capability) }).reasons)
      .toContain("too_many_capabilities");
    expect(evaluatePulse({ ...valid, requiredCapabilities: Array.from({ length: 101 }, (_, index) => `capability-${index}`) }).reasons)
      .toContain("too_many_required_capabilities");
  });

  it("rejects secrets, PII, malformed thresholds, and unbounded metrics without echoing values", () => {
    const result = evaluatePulse({
      ...valid,
      observations: [{ ...valid.observations[0]!, id: "person@example.com", latencyMs: Number.MAX_SAFE_INTEGER }],
      capabilities: [],
      requiredCapabilities: ["token=super-secret"],
      thresholds: { ...valid.thresholds, warningLatencyMs: 500, criticalLatencyMs: 100 },
    });
    expect(result.outcome).toBe("rejected");
    expect(result.light).toBeUndefined();
    expect(result.reasons.join(" ")).not.toContain("super-secret");
    expect(result.reasons).toEqual(expect.arrayContaining(["invalid_or_private_required_capability", "invalid_or_private_subject_id", "invalid_threshold_order", "invalid_or_unbounded_metric"]));
  });

  it("is deterministic, stably ordered, and immutable", () => {
    const input = structuredClone(valid);
    const snapshot = structuredClone(input);
    const reversed = { ...input, requiredCapabilities: [...input.requiredCapabilities].reverse(), capabilities: [...input.capabilities].reverse() };
    expect(evaluatePulse(reversed)).toEqual(evaluatePulse(input));
    expect(input).toEqual(snapshot);
  });
});
