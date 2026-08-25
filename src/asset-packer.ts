import type { Outcome } from "./types";

export type SupportedMediaType =
  | "image/avif"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "audio/aac"
  | "audio/ogg"
  | "audio/webm"
  | "font/otf"
  | "font/ttf"
  | "font/woff2"
  | "application/json";

export interface AssetOptimizationEvidence {
  readonly optimizerId: string;
  readonly evidenceId: string;
}

export interface AssetIntegrityEvidence {
  readonly verified: boolean;
  readonly evidenceId: string;
}

export interface AssetMetadata {
  readonly assetId: string;
  /** Canonical, relative POSIX destination path. */
  readonly path: string;
  readonly mediaType: string;
  readonly sourceDigest: string;
  readonly outputDigest: string;
  readonly sourceSizeBytes: number;
  readonly outputSizeBytes: number;
  readonly optimization?: AssetOptimizationEvidence;
  readonly integrity?: AssetIntegrityEvidence;
}

export interface MobileAssetBudget {
  readonly target: "android" | "mobile";
  readonly maxTotalBytes: number;
  readonly maxAssetBytes: number;
}

export interface AssetPackerInput {
  readonly assets: readonly AssetMetadata[];
  readonly budgets: readonly MobileAssetBudget[];
}

export interface PackingManifestEntry {
  readonly assetId: string;
  readonly path: string;
  readonly mediaType: SupportedMediaType;
  readonly sourceDigest: string;
  readonly outputDigest: string;
  readonly sourceSizeBytes: number;
  readonly outputSizeBytes: number;
  readonly optimizerId: string;
  readonly optimizationEvidenceId: string;
  readonly integrityEvidenceId: string;
}

export interface PackingManifest {
  readonly entries: readonly PackingManifestEntry[];
  readonly totalSourceBytes: number;
  readonly totalOutputBytes: number;
  readonly savingsBytes: number;
  readonly targets: readonly {
    readonly target: "android" | "mobile";
    readonly maxTotalBytes: number;
    readonly maxAssetBytes: number;
  }[];
}

export interface AssetPackerResult {
  readonly outcome: Outcome;
  readonly manifest?: PackingManifest;
  readonly reasons: readonly string[];
}

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PRIVATE_TEXT = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|secret|password|passwd|token|authorization|wallet|seed phrase|private key)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*)/i;
const SUPPORTED = new Set<string>([
  "application/json", "audio/aac", "audio/ogg", "audio/webm", "font/otf", "font/ttf",
  "font/woff2", "image/avif", "image/jpeg", "image/png", "image/webp",
]);
const MAX_ASSETS = 2_000;
const MAX_BUDGETS = 2;
const MAX_BYTES = 2_147_483_647;
const MAX_TOTAL_BYTES = 8_589_934_588;
const MAX_TEXT = 512;

function isSupportedMediaType(value: string): value is SupportedMediaType {
  return SUPPORTED.has(value);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function privateText(value: string): boolean {
  return EMAIL.test(value) || PRIVATE_TEXT.test(value);
}

function sameAsset(a: AssetMetadata, b: AssetMetadata): boolean {
  return a.assetId === b.assetId && a.path === b.path && a.mediaType === b.mediaType
    && a.sourceDigest === b.sourceDigest && a.outputDigest === b.outputDigest
    && a.sourceSizeBytes === b.sourceSizeBytes && a.outputSizeBytes === b.outputSizeBytes
    && a.optimization?.optimizerId === b.optimization?.optimizerId
    && a.optimization?.evidenceId === b.optimization?.evidenceId
    && a.integrity?.verified === b.integrity?.verified
    && a.integrity?.evidenceId === b.integrity?.evidenceId;
}

/**
 * Evaluates caller-supplied metadata and evidence. It does not read, compress,
 * decode, hash, write, upload, or otherwise transform any asset bytes.
 */
export function evaluateAssetPacking(input: AssetPackerInput): AssetPackerResult {
  const rejected: string[] = [];
  const blocked: string[] = [];
  if (input.assets.length > MAX_ASSETS) rejected.push("too_many_assets");
  if (input.budgets.length > MAX_BUDGETS) rejected.push("too_many_budgets");
  if (input.assets.length === 0) blocked.push("assets_missing");

  const byId = new Map<string, AssetMetadata>();
  const byPath = new Map<string, AssetMetadata>();
  let sourceTotal = 0;
  let outputTotal = 0;
  for (const asset of input.assets) {
    const texts = [asset.assetId, asset.path, asset.mediaType, asset.sourceDigest, asset.outputDigest,
      asset.optimization?.optimizerId ?? "", asset.optimization?.evidenceId ?? "",
      asset.integrity?.evidenceId ?? ""];
    if (texts.some((value) => value.length > MAX_TEXT)) rejected.push("asset_text_too_long");
    if (texts.some(privateText)) rejected.push("private_asset_text");
    if (!ID.test(asset.assetId)) rejected.push("invalid_asset_id");
    if (!PATH.test(asset.path) || asset.path.includes("//") || asset.path.endsWith("/")) rejected.push("invalid_asset_path");
    if (!isSupportedMediaType(asset.mediaType)) rejected.push("unsupported_media_type");
    if (!DIGEST.test(asset.sourceDigest) || !DIGEST.test(asset.outputDigest)) rejected.push("invalid_asset_digest");
    if (!Number.isSafeInteger(asset.sourceSizeBytes) || asset.sourceSizeBytes < 0 || asset.sourceSizeBytes > MAX_BYTES
      || !Number.isSafeInteger(asset.outputSizeBytes) || asset.outputSizeBytes < 0 || asset.outputSizeBytes > MAX_BYTES) {
      rejected.push("invalid_asset_size");
    } else {
      sourceTotal += asset.sourceSizeBytes;
      outputTotal += asset.outputSizeBytes;
      if (asset.outputSizeBytes > asset.sourceSizeBytes) rejected.push("asset_size_inflation");
    }
    if (asset.optimization === undefined || asset.optimization.optimizerId.trim() === ""
      || asset.optimization.evidenceId.trim() === "") blocked.push("optimization_evidence_missing");
    else if (!ID.test(asset.optimization.optimizerId) || !ID.test(asset.optimization.evidenceId)) rejected.push("invalid_optimization_evidence");
    if (asset.integrity === undefined || asset.integrity.evidenceId.trim() === "") blocked.push("integrity_evidence_missing");
    else {
      if (!ID.test(asset.integrity.evidenceId)) rejected.push("invalid_integrity_evidence");
      if (!asset.integrity.verified) rejected.push("integrity_verification_failed");
    }

    const priorId = byId.get(asset.assetId);
    if (priorId !== undefined) rejected.push(sameAsset(priorId, asset) ? "duplicate_asset" : "conflicting_asset_id");
    else byId.set(asset.assetId, asset);
    const priorPath = byPath.get(asset.path);
    if (priorPath !== undefined) rejected.push(sameAsset(priorPath, asset) ? "duplicate_asset" : "conflicting_asset_path");
    else byPath.set(asset.path, asset);
  }
  if (sourceTotal > MAX_TOTAL_BYTES || outputTotal > MAX_TOTAL_BYTES) rejected.push("aggregate_size_too_large");

  const budgetByTarget = new Map<string, MobileAssetBudget>();
  for (const budget of input.budgets) {
    if (!Number.isSafeInteger(budget.maxTotalBytes) || budget.maxTotalBytes < 1 || budget.maxTotalBytes > MAX_TOTAL_BYTES
      || !Number.isSafeInteger(budget.maxAssetBytes) || budget.maxAssetBytes < 1 || budget.maxAssetBytes > MAX_BYTES
      || budget.maxAssetBytes > budget.maxTotalBytes) rejected.push("invalid_budget");
    const prior = budgetByTarget.get(budget.target);
    if (prior !== undefined) rejected.push(
      prior.maxTotalBytes === budget.maxTotalBytes && prior.maxAssetBytes === budget.maxAssetBytes
        ? "duplicate_budget" : "conflicting_budget",
    );
    else budgetByTarget.set(budget.target, budget);
  }
  for (const target of ["android", "mobile"] as const) {
    const budget = budgetByTarget.get(target);
    if (budget === undefined) blocked.push(`${target}_budget_missing`);
    else {
      if (outputTotal > budget.maxTotalBytes) rejected.push(`${target}_total_budget_exceeded`);
      if (input.assets.some((asset) => Number.isSafeInteger(asset.outputSizeBytes)
        && asset.outputSizeBytes > budget.maxAssetBytes)) rejected.push(`${target}_asset_budget_exceeded`);
    }
  }
  if (rejected.length > 0) return { outcome: "rejected", reasons: sortedUnique(rejected) };
  if (blocked.length > 0) return { outcome: "blocked", reasons: sortedUnique(blocked) };

  const entries: PackingManifestEntry[] = [];
  for (const asset of input.assets) {
    const optimization = asset.optimization;
    const integrity = asset.integrity;
    if (optimization === undefined || optimization.optimizerId.trim() === ""
      || optimization.evidenceId.trim() === "" || integrity === undefined
      || integrity.evidenceId.trim() === "") {
      return { outcome: "blocked", reasons: ["asset_evidence_unavailable"] };
    }
    if (!isSupportedMediaType(asset.mediaType)) {
      return { outcome: "rejected", reasons: ["unsupported_media_type"] };
    }
    entries.push({
      assetId: asset.assetId,
      path: asset.path,
      mediaType: asset.mediaType,
      sourceDigest: asset.sourceDigest,
      outputDigest: asset.outputDigest,
      sourceSizeBytes: asset.sourceSizeBytes,
      outputSizeBytes: asset.outputSizeBytes,
      optimizerId: optimization.optimizerId,
      optimizationEvidenceId: optimization.evidenceId,
      integrityEvidenceId: integrity.evidenceId,
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path) || a.assetId.localeCompare(b.assetId));
  const targets = [...input.budgets].sort((a, b) => a.target.localeCompare(b.target));
  return {
    outcome: "verified",
    manifest: { entries, totalSourceBytes: sourceTotal, totalOutputBytes: outputTotal,
      savingsBytes: sourceTotal - outputTotal, targets },
    reasons: [],
  };
}
