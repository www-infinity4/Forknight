import type { ExtractionEvaluation, ExtractionManifest } from "./types";

const permissive = new Set(["MIT", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "APACHE-2.0", "ISC", "CC0-1.0"]);
const reciprocal = new Set(["GPL-2.0", "GPL-3.0", "AGPL-3.0", "SSPL-1.0"]);

export function evaluateExtraction(manifest: ExtractionManifest): ExtractionEvaluation {
  const license = manifest.detectedLicense.trim().toUpperCase();
  const reasons: string[] = [];

  if (manifest.policyFlags.length > 0) {
    return { decision: "rejected", reasons: ["policy-flags:" + manifest.policyFlags.join(",")], manifest };
  }
  if (reciprocal.has(license)) {
    if (manifest.method === "clean-room") {
      return { decision: "review-required", reasons: ["legal-review-for-clean-room-boundary"], manifest };
    }
    return { decision: "rejected", reasons: ["license-incompatible-with-direct-" + manifest.method], manifest };
  }
  if (!permissive.has(license)) {
    return { decision: "review-required", reasons: ["unknown-or-unclassified-license"], manifest };
  }
  if (manifest.method !== "clean-room" && manifest.attributionRequirements.length === 0) {
    reasons.push("attribution-review-required");
  }
  return {
    decision: reasons.length ? "review-required" : "allowed",
    reasons,
    manifest
  };
}
