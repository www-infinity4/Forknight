import { describe, expect, it } from "vitest";
import { balanceSwarm, type SwarmBalancerInput, type WorkerEvidence } from "../src/swarm-balancer";

const worker = (workerId: string, costCredits: number, latencyMs: number): WorkerEvidence => ({
  workerId,
  delegatedTaskId: `delegated-${workerId}`,
  capabilityEvidence: { status: "verified", capabilities: ["typescript", "tests"] },
  capacityEvidence: { status: "verified", availableUnits: 2 },
  costCredits,
  latencyMs,
});

const base: SwarmBalancerInput = {
  requirements: {
    taskId: "task-13",
    requiredCapabilities: ["typescript", "tests"],
    capacityUnits: 1,
    maxCostCredits: 10,
    maxLatencyMs: 1_000,
    maxAttempts: 3,
    ancestryTaskIds: ["root-task"],
    attemptedWorkerIds: [],
  },
  workers: [worker("worker-b", 2, 100), worker("worker-a", 1, 200), worker("worker-c", 3, 50)],
  maxFallbacks: 1,
};

describe("balanceSwarm", () => {
  it("produces an immutable deterministic primary and bounded fallback plan", () => {
    const before = JSON.stringify(base);
    const first = balanceSwarm(base);
    expect(first).toEqual(balanceSwarm(base));
    expect(first.outcome).toBe("verified");
    expect(first.plan?.primary.workerId).toBe("worker-a");
    expect(first.plan?.fallbacks.map((item) => item.workerId)).toEqual(["worker-b"]);
    expect(Object.isFrozen(first.plan?.fallbacks)).toBe(true);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("uses worker id as a stable tie-breaker", () => {
    const result = balanceSwarm({ ...base, workers: [worker("worker-z", 1, 100), worker("worker-a", 1, 100)] });
    expect(result.plan?.primary.workerId).toBe("worker-a");
  });

  it("rejects workers exceeding cost or latency budgets", () => {
    const result = balanceSwarm({ ...base, workers: [worker("expensive", 11, 100), worker("slow", 1, 1_001)] });
    expect(result).toEqual({ outcome: "rejected", reasons: ["no_eligible_worker"] });
  });

  it("prevents task and worker routing loops and enforces max attempts", () => {
    const attempted = balanceSwarm({
      ...base,
      requirements: { ...base.requirements, attemptedWorkerIds: ["worker-a"] },
      workers: [worker("worker-a", 1, 100)],
    });
    expect(attempted.outcome).toBe("rejected");
    expect(balanceSwarm({
      ...base,
      requirements: { ...base.requirements, attemptedWorkerIds: ["a", "b", "c"] },
    }).reasons).toEqual(["maximum_attempts_reached"]);
    expect(balanceSwarm({
      ...base,
      workers: [{ ...worker("worker-a", 1, 100), delegatedTaskId: "root-task" }],
    }).outcome).toBe("rejected");
    const lastAttempt = balanceSwarm({
      ...base,
      requirements: { ...base.requirements, attemptedWorkerIds: ["old-a", "old-b"] },
      maxFallbacks: 2,
    });
    expect(lastAttempt.plan?.fallbacks).toEqual([]);
  });

  it("blocks when capability or capacity evidence is unavailable", () => {
    expect(balanceSwarm({
      ...base,
      workers: [{ ...worker("worker-a", 1, 100), capacityEvidence: undefined }],
    })).toEqual({ outcome: "blocked", reasons: ["worker_evidence_unavailable"] });
  });

  it("rejects invalid or failed evidence when no worker is eligible", () => {
    expect(balanceSwarm({
      ...base,
      workers: [{ ...worker("worker-a", 1, 100), costCredits: -1 }],
    }).reasons).toEqual(["invalid_worker_evidence"]);
    expect(balanceSwarm({
      ...base,
      workers: [{ ...worker("worker-a", 1, 100), capabilityEvidence: { status: "failed", capabilities: [] } }],
    })).toEqual({ outcome: "rejected", reasons: ["no_eligible_worker"] });
  });

  it("rejects oversized planning inputs", () => {
    const tooManyCapabilities = Array.from({ length: 65 }, (_, index) => `capability-${index}`);
    expect(balanceSwarm({
      ...base,
      requirements: { ...base.requirements, requiredCapabilities: tooManyCapabilities },
    }).reasons).toEqual(["invalid_task_requirements"]);
    expect(balanceSwarm({ ...base, maxFallbacks: 33 }).reasons).toEqual(["invalid_task_requirements"]);
    expect(balanceSwarm({
      ...base,
      workers: Array.from({ length: 257 }, (_, index) => worker(`worker-${index}`, 1, 100)),
    }).reasons).toEqual(["invalid_task_requirements"]);
  });
});
