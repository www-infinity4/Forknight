import type { Outcome } from "./types";

export type EvidenceStatus = "verified" | "unavailable" | "failed";

export interface TaskRequirements {
  readonly taskId: string;
  readonly requiredCapabilities: readonly string[];
  readonly capacityUnits: number;
  readonly maxCostCredits: number;
  readonly maxLatencyMs: number;
  readonly maxAttempts: number;
  readonly ancestryTaskIds: readonly string[];
  readonly attemptedWorkerIds: readonly string[];
}

export interface CapabilityEvidence {
  readonly status: EvidenceStatus;
  readonly capabilities: readonly string[];
}

export interface CapacityEvidence {
  readonly status: EvidenceStatus;
  readonly availableUnits: number;
}

export interface WorkerEvidence {
  readonly workerId: string;
  readonly delegatedTaskId: string;
  readonly capabilityEvidence?: CapabilityEvidence;
  readonly capacityEvidence?: CapacityEvidence;
  readonly costCredits: number;
  readonly latencyMs: number;
}

export interface SwarmBalancerInput {
  readonly requirements: TaskRequirements;
  readonly workers: readonly WorkerEvidence[];
  readonly maxFallbacks: number;
}

export interface RankedAssignment {
  readonly workerId: string;
  readonly delegatedTaskId: string;
  readonly rank: number;
  readonly costCredits: number;
  readonly latencyMs: number;
}

export interface AssignmentPlan {
  readonly primary: RankedAssignment;
  readonly fallbacks: readonly RankedAssignment[];
}

export interface SwarmBalancerResult {
  readonly outcome: Outcome;
  readonly reasons: readonly string[];
  readonly plan?: AssignmentPlan;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_WORKERS = 256;
const MAX_CAPABILITIES = 64;
const MAX_HISTORY_IDS = 256;
const MAX_FALLBACKS = 32;

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function uniqueValidIds(values: readonly string[]): boolean {
  return values.every(validId) && new Set(values).size === values.length;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function output(value: SwarmBalancerResult): SwarmBalancerResult {
  return freeze(value);
}

/** Creates an assignment manifest only. It never invokes workers, models, or billing. */
export function balanceSwarm(input: SwarmBalancerInput): SwarmBalancerResult {
  const requirement = input.requirements;
  if (
    !validId(requirement.taskId) ||
    !uniqueValidIds(requirement.requiredCapabilities) ||
    requirement.requiredCapabilities.length === 0 || requirement.requiredCapabilities.length > MAX_CAPABILITIES ||
    !Number.isInteger(requirement.capacityUnits) || requirement.capacityUnits <= 0 ||
    !finiteNonnegative(requirement.maxCostCredits) ||
    !finiteNonnegative(requirement.maxLatencyMs) ||
    !Number.isInteger(requirement.maxAttempts) || requirement.maxAttempts <= 0 ||
    !uniqueValidIds(requirement.ancestryTaskIds) || requirement.ancestryTaskIds.length > MAX_HISTORY_IDS ||
    !uniqueValidIds(requirement.attemptedWorkerIds) || requirement.attemptedWorkerIds.length > MAX_HISTORY_IDS ||
    !Number.isInteger(input.maxFallbacks) || input.maxFallbacks < 0 || input.maxFallbacks > MAX_FALLBACKS ||
    input.workers.length > MAX_WORKERS
  ) return output({ outcome: "rejected", reasons: ["invalid_task_requirements"] });

  if (requirement.ancestryTaskIds.includes(requirement.taskId)) {
    return output({ outcome: "rejected", reasons: ["task_ancestry_loop"] });
  }
  if (requirement.attemptedWorkerIds.length >= requirement.maxAttempts) {
    return output({ outcome: "rejected", reasons: ["maximum_attempts_reached"] });
  }
  const workerIds = input.workers.map((worker) => worker.workerId);
  if (new Set(workerIds).size !== workerIds.length) {
    return output({ outcome: "rejected", reasons: ["duplicate_worker_id"] });
  }

  let unavailable = false;
  const eligible: WorkerEvidence[] = [];
  for (const worker of input.workers) {
    const capability = worker.capabilityEvidence;
    const capacity = worker.capacityEvidence;
    if (
      !validId(worker.workerId) || !validId(worker.delegatedTaskId) ||
      !finiteNonnegative(worker.costCredits) || !finiteNonnegative(worker.latencyMs) ||
      (capability !== undefined && (!uniqueValidIds(capability.capabilities) ||
        capability.capabilities.length > MAX_CAPABILITIES ||
        (capability.status !== "verified" && capability.status !== "unavailable" && capability.status !== "failed"))) ||
      (capacity !== undefined && (!Number.isInteger(capacity.availableUnits) || capacity.availableUnits < 0 ||
        (capacity.status !== "verified" && capacity.status !== "unavailable" && capacity.status !== "failed")))
    ) return output({ outcome: "rejected", reasons: ["invalid_worker_evidence"] });

    if (capability === undefined || capacity === undefined ||
      capability.status === "unavailable" || capacity.status === "unavailable") {
      unavailable = true;
      continue;
    }
    if (capability.status !== "verified" || capacity.status !== "verified") continue;
    if (requirement.attemptedWorkerIds.includes(worker.workerId)) continue;
    if (requirement.ancestryTaskIds.includes(worker.delegatedTaskId) || worker.delegatedTaskId === requirement.taskId) continue;
    if (!requirement.requiredCapabilities.every((item) => capability.capabilities.includes(item))) continue;
    if (capacity.availableUnits < requirement.capacityUnits) continue;
    if (worker.costCredits > requirement.maxCostCredits || worker.latencyMs > requirement.maxLatencyMs) continue;
    eligible.push(worker);
  }

  if (eligible.length === 0) {
    return unavailable
      ? output({ outcome: "blocked", reasons: ["worker_evidence_unavailable"] })
      : output({ outcome: "rejected", reasons: ["no_eligible_worker"] });
  }

  const ranked = [...eligible].sort((left, right) =>
    left.costCredits - right.costCredits || left.latencyMs - right.latencyMs ||
    compareText(left.workerId, right.workerId) || compareText(left.delegatedTaskId, right.delegatedTaskId));
  const assignments = ranked.map((worker, index): RankedAssignment => ({
    workerId: worker.workerId,
    delegatedTaskId: worker.delegatedTaskId,
    rank: index + 1,
    costCredits: worker.costCredits,
    latencyMs: worker.latencyMs,
  }));
  const [primary, ...fallbackCandidates] = assignments;
  if (primary === undefined) {
    return output({ outcome: "rejected", reasons: ["no_eligible_worker"] });
  }
  const remainingAttempts = requirement.maxAttempts - requirement.attemptedWorkerIds.length;
  const fallbackCount = Math.min(input.maxFallbacks, remainingAttempts - 1);
  return output({
    outcome: "verified",
    reasons: [],
    plan: { primary, fallbacks: fallbackCandidates.slice(0, fallbackCount) },
  });
}
