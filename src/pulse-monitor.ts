import type { Outcome } from "./types";

export type ReadinessLight = "green" | "yellow" | "red";
export type SubjectKind = "worker" | "site";
export type HealthStatus = "healthy" | "degraded" | "failed" | "blocked";

export interface HealthObservation {
  readonly id: string;
  readonly kind: SubjectKind;
  readonly status: HealthStatus;
  readonly latencyMs: number;
  readonly queueDepth: number;
  readonly errorCount: number;
  readonly observedAt: string;
  readonly evidenceAvailable: boolean;
}

export interface CapabilityObservation {
  readonly subjectId: string;
  readonly capability: string;
  readonly operational: boolean;
  readonly evidenceAvailable: boolean;
}

export interface PulseThresholds {
  readonly warningLatencyMs: number;
  readonly criticalLatencyMs: number;
  readonly warningQueueDepth: number;
  readonly criticalQueueDepth: number;
  readonly warningErrorCount: number;
  readonly criticalErrorCount: number;
  readonly maxObservationAgeMs: number;
}

export interface PulseMonitorInput {
  readonly evaluatedAt: string;
  readonly observations: readonly HealthObservation[];
  readonly capabilities: readonly CapabilityObservation[];
  /** Capabilities such as wallet, plugin, or filter which every subject must prove. */
  readonly requiredCapabilities: readonly string[];
  readonly thresholds: PulseThresholds;
}

export interface CapabilityCoverage {
  readonly subjectId: string;
  readonly operational: readonly string[];
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
}

export interface PulseMonitorResult {
  /** Validation result for this module invocation, not the observed readiness light. */
  readonly outcome: Outcome;
  readonly light?: ReadinessLight;
  readonly reasons: readonly string[];
  readonly coverage?: readonly CapabilityCoverage[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const CAPABILITY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SECRET = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*)/i;
const MAX_METRIC = 1_000_000_000;
const MAX_OBSERVATIONS = 1_000;
const MAX_CAPABILITIES = 10_000;
const MAX_REQUIRED_CAPABILITIES = 100;

function privateValue(value: string): boolean {
  return EMAIL.test(value) || SECRET.test(value);
}

function validTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return value.includes(".") ? date.toISOString() === value : date.toISOString().replace(".000Z", "Z") === value;
}

function validMetric(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_METRIC;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function reason(kind: ReadinessLight, subject: string, detail: string): string {
  return `${kind}:${subject}:${detail}`;
}

/**
 * Evaluates caller-supplied evidence only. It collects no telemetry and performs
 * no clock, network, filesystem, wallet, plugin, or storage operations.
 */
export function evaluatePulse(input: PulseMonitorInput): PulseMonitorResult {
  const excessive: string[] = [];
  if (input.observations.length > MAX_OBSERVATIONS) excessive.push("too_many_observations");
  if (input.capabilities.length > MAX_CAPABILITIES) excessive.push("too_many_capabilities");
  if (input.requiredCapabilities.length > MAX_REQUIRED_CAPABILITIES) excessive.push("too_many_required_capabilities");
  if (excessive.length > 0) return { outcome: "rejected", reasons: excessive.sort() };

  const invalid: string[] = [];
  if (!validTimestamp(input.evaluatedAt)) invalid.push("invalid_evaluated_at");

  const t = input.thresholds;
  const thresholdValues = [t.warningLatencyMs, t.criticalLatencyMs, t.warningQueueDepth,
    t.criticalQueueDepth, t.warningErrorCount, t.criticalErrorCount, t.maxObservationAgeMs];
  if (thresholdValues.some((value) => !validMetric(value))) invalid.push("invalid_threshold");
  if (t.warningLatencyMs >= t.criticalLatencyMs || t.warningQueueDepth >= t.criticalQueueDepth ||
      t.warningErrorCount >= t.criticalErrorCount) invalid.push("invalid_threshold_order");

  const required = sortedUnique(input.requiredCapabilities);
  if (required.some((value) => !CAPABILITY.test(value) || privateValue(value))) invalid.push("invalid_or_private_required_capability");

  const observations = [...input.observations].sort((a, b) => a.id.localeCompare(b.id));
  const seenSubjects = new Set<string>();
  for (const observation of observations) {
    if (!ID.test(observation.id) || privateValue(observation.id)) invalid.push("invalid_or_private_subject_id");
    if (seenSubjects.has(observation.id)) invalid.push("duplicate_subject_observation");
    seenSubjects.add(observation.id);
    if (![observation.latencyMs, observation.queueDepth, observation.errorCount].every(validMetric)) invalid.push("invalid_or_unbounded_metric");
    if (!validTimestamp(observation.observedAt)) invalid.push("invalid_observation_timestamp");
  }

  const capabilities = [...input.capabilities].sort((a, b) =>
    a.subjectId.localeCompare(b.subjectId) || a.capability.localeCompare(b.capability));
  const seenCapabilities = new Map<string, string>();
  for (const capability of capabilities) {
    if (!ID.test(capability.subjectId) || privateValue(capability.subjectId)) invalid.push("invalid_or_private_capability_subject");
    if (!CAPABILITY.test(capability.capability) || privateValue(capability.capability)) invalid.push("invalid_or_private_capability");
    if (!seenSubjects.has(capability.subjectId)) invalid.push("capability_subject_not_observed");
    const key = `${capability.subjectId}\u0000${capability.capability}`;
    const fingerprint = `${capability.operational}\u0000${capability.evidenceAvailable}`;
    const prior = seenCapabilities.get(key);
    if (prior !== undefined && prior !== fingerprint) invalid.push("conflicting_capability_evidence");
    seenCapabilities.set(key, fingerprint);
  }

  if (invalid.length > 0) return { outcome: "rejected", reasons: sortedUnique(invalid) };
  const unavailable: string[] = [];
  if (observations.length === 0) unavailable.push("health_evidence_unavailable");
  if (required.length === 0) unavailable.push("required_capability_evidence_unavailable");
  if (unavailable.length > 0) return { outcome: "blocked", reasons: unavailable.sort() };

  const red: string[] = [];
  const yellow: string[] = [];
  const green: string[] = [];
  const evaluatedAt = new Date(input.evaluatedAt).getTime();
  const coverage: CapabilityCoverage[] = observations.map((observation) => {
    const supplied = new Map<string, CapabilityObservation>();
    for (const capability of capabilities) {
      if (capability.subjectId === observation.id) supplied.set(capability.capability, capability);
    }
    const operational: string[] = [];
    const missing: string[] = [];
    const unknown: string[] = [];
    for (const name of required) {
      const evidence = supplied.get(name);
      if (evidence === undefined || !evidence.evidenceAvailable) unknown.push(name);
      else if (evidence.operational) operational.push(name);
      else missing.push(name);
    }
    return { subjectId: observation.id, operational, missing, unknown };
  });

  for (const observation of observations) {
    const id = observation.id;
    if (!observation.evidenceAvailable) yellow.push(reason("yellow", id, "health_evidence_unavailable"));
    if (observation.status === "failed" || observation.status === "blocked") red.push(reason("red", id, `status_${observation.status}`));
    else if (observation.status === "degraded") yellow.push(reason("yellow", id, "status_degraded"));

    const observedAt = new Date(observation.observedAt).getTime();
    if (observedAt > evaluatedAt) red.push(reason("red", id, "observation_from_future"));
    else if (evaluatedAt - observedAt > t.maxObservationAgeMs) yellow.push(reason("yellow", id, "observation_stale"));

    const metrics: readonly [string, number, number, number][] = [
      ["latency", observation.latencyMs, t.warningLatencyMs, t.criticalLatencyMs],
      ["queue_depth", observation.queueDepth, t.warningQueueDepth, t.criticalQueueDepth],
      ["error_count", observation.errorCount, t.warningErrorCount, t.criticalErrorCount],
    ];
    for (const [name, value, warning, critical] of metrics) {
      if (value >= critical) red.push(reason("red", id, `${name}_critical`));
      else if (value >= warning) yellow.push(reason("yellow", id, `${name}_warning`));
    }

    const subjectCoverage = coverage.find((item) => item.subjectId === id)!;
    for (const name of subjectCoverage.missing) red.push(reason("red", id, `capability_${name}_not_operational`));
    for (const name of subjectCoverage.unknown) yellow.push(reason("yellow", id, `capability_${name}_evidence_unavailable`));
    if (observation.evidenceAvailable && observation.status === "healthy" &&
        subjectCoverage.missing.length === 0 && subjectCoverage.unknown.length === 0 &&
        !red.some((item) => item.startsWith(`red:${id}:`)) && !yellow.some((item) => item.startsWith(`yellow:${id}:`))) {
      green.push(reason("green", id, "complete_passing_evidence"));
    }
  }

  const light: ReadinessLight = red.length > 0 ? "red" : yellow.length > 0 ? "yellow" : "green";
  return { outcome: "verified", light, reasons: sortedUnique(light === "red" ? [...red, ...yellow] : light === "yellow" ? yellow : green), coverage };
}
