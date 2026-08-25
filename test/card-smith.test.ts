import { describe, expect, it } from "vitest";
import { planTradingCards, type CardSmithInput } from "../src/card-smith";

const INPUT: CardSmithInput = {
  collectionId: "forknight-founders",
  collectionDigest: "a".repeat(64),
  provenanceReference: "creation-record:forknight/2026/founders",
  print: { widthMm: 63, heightMm: 88, bleedMm: 3, safeMarginMm: 5, dpi: 300 },
  variants: [
    { id: "founder-one", digest: "b".repeat(64), serial: 1, editionSize: 1, title: "The Founder", body: "First-edition metadata.", imageReference: "asset:founder-original" },
    { id: "builder-two", digest: "c".repeat(64), serial: 2, editionSize: 10, title: "The Builder", subtitle: "Founders series" },
  ],
};

describe("planTradingCards", () => {
  it("creates clean printable plans and numbered variants", () => {
    const result = planTradingCards(INPUT);
    expect(result).toMatchObject({ outcome: "verified" });
    expect(result.plan?.cards.map((card) => card.numbering)).toEqual(["1/1", "2/10"]);
    expect(result.plan?.cards[0]).toMatchObject({
      id: "founder-one",
      digest: "b".repeat(64),
      trimBox: { width: 63, height: 88 },
      bleedBox: { x: -3, y: -3, width: 69, height: 94 },
      safeBox: { x: 5, y: 5, width: 53, height: 78 },
    });
    expect(result.plan?.notices.join(" ")).toContain("does not grant ownership");
  });

  it("is deterministic and preserves input immutability", () => {
    const before = JSON.stringify(INPUT);
    expect(planTradingCards(INPUT)).toEqual(planTradingCards(INPUT));
    expect(JSON.stringify(INPUT)).toBe(before);
  });

  it("accepts text exactly at its boundary", () => {
    const result = planTradingCards({ ...INPUT, variants: [{ ...INPUT.variants[0]!, title: "T".repeat(80), body: "B".repeat(500) }] });
    expect(result.outcome).toBe("verified");
  });

  it("rejects unsafe overflow, invalid numbering, and duplicate serials", () => {
    expect(planTradingCards({ ...INPUT, variants: [{ ...INPUT.variants[0]!, title: "T".repeat(81) }] })).toMatchObject({ outcome: "rejected", reasons: ["variants[0].title exceeds 80 characters"] });
    expect(planTradingCards({ ...INPUT, variants: [{ ...INPUT.variants[0]!, serial: 2, editionSize: 1 }] })).toMatchObject({ outcome: "rejected" });
    expect(planTradingCards({ ...INPUT, variants: [INPUT.variants[0]!, { ...INPUT.variants[0]!, id: "another", digest: "d".repeat(64) }] })).toMatchObject({ outcome: "rejected", reasons: ["variants[1] duplicates serial 1/1"] });
    expect(planTradingCards({ ...INPUT, print: { ...INPUT.print, safeMarginMm: 32 } })).toMatchObject({ outcome: "rejected", reasons: ["print.safeMarginMm leaves no printable safe zone"] });
  });

  it("requires canonical lowercase SHA-256 digests", () => {
    expect(planTradingCards({ ...INPUT, collectionDigest: "A".repeat(64) })).toMatchObject({
      outcome: "rejected",
      reasons: ["collectionDigest must be a lowercase 64-character SHA-256 hex digest"],
    });
    expect(planTradingCards({ ...INPUT, variants: [{ ...INPUT.variants[0]!, digest: "abc123" }] })).toMatchObject({
      outcome: "rejected",
      reasons: ["variants[0].digest must be a lowercase 64-character SHA-256 hex digest"],
    });
  });

  it("bounds variant count and print resources", () => {
    const variants = Array.from({ length: 501 }, (_, index) => ({
      ...INPUT.variants[0]!, id: `card-${index}`, digest: index.toString(16).padStart(64, "0"), serial: index + 1, editionSize: 501,
    }));
    expect(planTradingCards({ ...INPUT, variants })).toMatchObject({ outcome: "rejected", reasons: ["variants must not exceed 500 entries"] });
    expect(planTradingCards({ ...INPUT, print: { ...INPUT.print, widthMm: 1_001 } })).toMatchObject({ outcome: "rejected", reasons: ["print.widthMm must not exceed 1000"] });
    expect(planTradingCards({ ...INPUT, print: { ...INPUT.print, heightMm: Number.POSITIVE_INFINITY } })).toMatchObject({ outcome: "rejected", reasons: ["print.heightMm must be a positive finite number"] });
    expect(planTradingCards({ ...INPUT, print: { ...INPUT.print, bleedMm: 51 } })).toMatchObject({ outcome: "rejected", reasons: ["print.bleedMm must not exceed 50"] });
    expect(planTradingCards({ ...INPUT, print: { ...INPUT.print, bleedMm: 32 } })).toMatchObject({ outcome: "rejected", reasons: ["print.bleedMm must be less than half the shortest dimension"] });
    expect(planTradingCards({ ...INPUT, print: { ...INPUT.print, safeMarginMm: 101 } })).toMatchObject({ outcome: "rejected", reasons: ["print.safeMarginMm must not exceed 100"] });
    expect(planTradingCards({ ...INPUT, print: { ...INPUT.print, dpi: 2_401 } })).toMatchObject({ outcome: "rejected", reasons: ["print.dpi must not exceed 2400"] });
  });

  it("blocks absent provenance and retains a supplied provenance reference", () => {
    const blocked = planTradingCards({ ...INPUT, provenanceReference: " " });
    expect(blocked).toMatchObject({ outcome: "blocked" });
    expect(blocked.plan).toBeUndefined();
    expect(planTradingCards(INPUT).plan?.provenanceReference).toBe(INPUT.provenanceReference);
  });
});
