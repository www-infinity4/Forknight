import { describe, expect, it } from "vitest";
import { evaluateAssetPacking, type AssetPackerInput } from "../src/asset-packer";

const a = "a".repeat(64);
const b = "b".repeat(64);
const valid: AssetPackerInput = {
  assets: [
    { assetId: "hero", path: "images/hero.webp", mediaType: "image/webp", sourceDigest: a,
      outputDigest: b, sourceSizeBytes: 1_000, outputSizeBytes: 600,
      optimization: { optimizerId: "webp-tool", evidenceId: "opt-hero" },
      integrity: { verified: true, evidenceId: "hash-check-hero" } },
    { assetId: "data", path: "data/cards.json", mediaType: "application/json", sourceDigest: b,
      outputDigest: a, sourceSizeBytes: 500, outputSizeBytes: 400,
      optimization: { optimizerId: "json-tool", evidenceId: "opt-data" },
      integrity: { verified: true, evidenceId: "hash-check-data" } },
  ],
  budgets: [
    { target: "mobile", maxTotalBytes: 2_000, maxAssetBytes: 1_000 },
    { target: "android", maxTotalBytes: 1_500, maxAssetBytes: 800 },
  ],
};

describe("evaluateAssetPacking", () => {
  it("creates a stable evidence-backed manifest without claiming byte optimization", () => {
    expect(evaluateAssetPacking(valid)).toEqual({
      outcome: "verified",
      manifest: {
        entries: [
          { assetId: "data", path: "data/cards.json", mediaType: "application/json", sourceDigest: b,
            outputDigest: a, sourceSizeBytes: 500, outputSizeBytes: 400, optimizerId: "json-tool",
            optimizationEvidenceId: "opt-data", integrityEvidenceId: "hash-check-data" },
          { assetId: "hero", path: "images/hero.webp", mediaType: "image/webp", sourceDigest: a,
            outputDigest: b, sourceSizeBytes: 1_000, outputSizeBytes: 600, optimizerId: "webp-tool",
            optimizationEvidenceId: "opt-hero", integrityEvidenceId: "hash-check-hero" },
        ],
        totalSourceBytes: 1_500, totalOutputBytes: 1_000, savingsBytes: 500,
        targets: [
          { target: "android", maxTotalBytes: 1_500, maxAssetBytes: 800 },
          { target: "mobile", maxTotalBytes: 2_000, maxAssetBytes: 1_000 },
        ],
      },
      reasons: [],
    });
  });

  it("rejects manifests outside declared Android and mobile budgets", () => {
    expect(evaluateAssetPacking({ ...valid, budgets: valid.budgets.map((budget) =>
      ({ ...budget, maxTotalBytes: 900, maxAssetBytes: 500 })) })).toEqual({
      outcome: "rejected",
      reasons: ["android_asset_budget_exceeded", "android_total_budget_exceeded",
        "mobile_asset_budget_exceeded", "mobile_total_budget_exceeded"],
    });
  });

  it("blocks missing optimizer and integrity evidence", () => {
    const asset = valid.assets[0]!;
    expect(evaluateAssetPacking({ ...valid, assets: [{ ...asset, optimization: undefined, integrity: undefined }] })).toEqual({
      outcome: "blocked", reasons: ["integrity_evidence_missing", "optimization_evidence_missing"],
    });
  });

  it("rejects malformed paths and digests, inflation, unsupported types, and private text", () => {
    const result = evaluateAssetPacking({ ...valid, assets: [{ ...valid.assets[0]!,
      path: "../wallet/password=hidden.png", sourceDigest: "BAD", mediaType: "video/mp4",
      outputSizeBytes: 1_001 }] });
    expect(result.outcome).toBe("rejected");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "asset_size_inflation", "invalid_asset_digest", "invalid_asset_path", "private_asset_text", "unsupported_media_type",
    ]));
    expect(result.reasons.join(" ")).not.toContain("hidden");
  });

  it("rejects duplicate and conflicting identities and paths", () => {
    const first = valid.assets[0]!;
    expect(evaluateAssetPacking({ ...valid, assets: [first, first] }).reasons).toContain("duplicate_asset");
    const conflict = { ...first, outputDigest: a, path: valid.assets[1]!.path };
    expect(evaluateAssetPacking({ ...valid, assets: [...valid.assets, conflict] }).reasons).toEqual(
      expect.arrayContaining(["conflicting_asset_id", "conflicting_asset_path"]),
    );
  });

  it("is deterministic and preserves caller input", () => {
    const input = structuredClone(valid);
    const snapshot = structuredClone(input);
    expect(evaluateAssetPacking(input)).toEqual(evaluateAssetPacking(structuredClone(input)));
    expect(input).toEqual(snapshot);
  });
});
