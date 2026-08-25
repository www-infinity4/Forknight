import type { Outcome } from "./types";

export interface PrintSpecification {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bleedMm: number;
  readonly safeMarginMm: number;
  readonly dpi: number;
}

export interface CardVariantInput {
  readonly id: string;
  readonly digest: string;
  readonly serial: number;
  readonly editionSize: number;
  readonly title: string;
  readonly subtitle?: string;
  readonly body?: string;
  readonly attribution?: string;
  /** Caller-controlled asset reference only; CardSmith never fetches it. */
  readonly imageReference?: string;
}

export interface CardSmithInput {
  readonly collectionId: string;
  readonly collectionDigest: string;
  /** Verifiable source, licence, or creation-record reference supplied by the caller. */
  readonly provenanceReference: string;
  readonly print: PrintSpecification;
  readonly variants: readonly CardVariantInput[];
}

export interface RectangleMm {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CardLayoutPlan {
  readonly id: string;
  readonly digest: string;
  readonly numbering: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly body?: string;
  readonly attribution?: string;
  readonly imageReference?: string;
  readonly trimBox: RectangleMm;
  readonly bleedBox: RectangleMm;
  readonly safeBox: RectangleMm;
  readonly zones: {
    readonly image: RectangleMm;
    readonly title: RectangleMm;
    readonly details: RectangleMm;
    readonly numbering: RectangleMm;
  };
}

export interface CardSmithPlan {
  readonly collectionId: string;
  readonly collectionDigest: string;
  readonly provenanceReference: string;
  readonly print: PrintSpecification;
  readonly cards: readonly CardLayoutPlan[];
  readonly notices: readonly string[];
}

export interface CardSmithResult {
  readonly outcome: Outcome;
  readonly reasons: readonly string[];
  readonly plan?: CardSmithPlan;
}

const LIMITS = { id: 100, digest: 200, reference: 500, title: 80, subtitle: 120, body: 500, attribution: 120 } as const;
const MAX_VARIANTS = 500;
const PRINT_MAX = { dimensionMm: 1_000, bleedMm: 50, safeMarginMm: 100, dpi: 2_400 } as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function text(value: string, path: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new TypeError(`${path} must not be blank`);
  if (normalized.length > limit) throw new TypeError(`${path} exceeds ${limit} characters`);
  return normalized;
}

function optionalText(value: string | undefined, path: string, limit: number): string | undefined {
  return value === undefined ? undefined : text(value, path, limit);
}

function positive(value: number, path: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${path} must be a positive finite number`);
  return value;
}

function boundedPositive(value: number, path: string, maximum: number): number {
  const result = positive(value, path);
  if (result > maximum) throw new TypeError(`${path} must not exceed ${maximum}`);
  return result;
}

function digest(value: string, path: string): string {
  if (!SHA256_HEX.test(value)) throw new TypeError(`${path} must be a lowercase 64-character SHA-256 hex digest`);
  return value;
}

function integer(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${path} must be a positive safe integer`);
  return value;
}

function rect(x: number, y: number, width: number, height: number): RectangleMm {
  return { x, y, width, height };
}

/** Pure planner: it performs no I/O, asset acquisition, clock, random, or cryptographic operations. */
export function planTradingCards(input: CardSmithInput): CardSmithResult {
  if (!input.provenanceReference.trim()) {
    return { outcome: "blocked", reasons: ["provenanceReference is required before a layout can be verified"] };
  }
  try {
    const collectionId = text(input.collectionId, "collectionId", LIMITS.id);
    const collectionDigest = digest(input.collectionDigest, "collectionDigest");
    const provenanceReference = text(input.provenanceReference, "provenanceReference", LIMITS.reference);
    if (input.variants.length === 0) throw new TypeError("variants must not be empty");
    if (input.variants.length > MAX_VARIANTS) throw new TypeError(`variants must not exceed ${MAX_VARIANTS} entries`);

    const widthMm = boundedPositive(input.print.widthMm, "print.widthMm", PRINT_MAX.dimensionMm);
    const heightMm = boundedPositive(input.print.heightMm, "print.heightMm", PRINT_MAX.dimensionMm);
    const bleedMm = boundedPositive(input.print.bleedMm, "print.bleedMm", PRINT_MAX.bleedMm);
    const safeMarginMm = boundedPositive(input.print.safeMarginMm, "print.safeMarginMm", PRINT_MAX.safeMarginMm);
    const dpi = integer(input.print.dpi, "print.dpi");
    if (dpi > PRINT_MAX.dpi) throw new TypeError(`print.dpi must not exceed ${PRINT_MAX.dpi}`);
    if (bleedMm * 2 >= Math.min(widthMm, heightMm)) {
      throw new TypeError("print.bleedMm must be less than half the shortest dimension");
    }
    if (safeMarginMm * 2 >= widthMm || safeMarginMm * 2 >= heightMm) {
      throw new TypeError("print.safeMarginMm leaves no printable safe zone");
    }
    const print: PrintSpecification = { widthMm, heightMm, bleedMm, safeMarginMm, dpi };
    const seenSerials = new Set<string>();
    const seenIds = new Set<string>();

    const cards = input.variants.map((variant, index): CardLayoutPlan => {
      const path = `variants[${index}]`;
      const id = text(variant.id, `${path}.id`, LIMITS.id);
      const variantDigest = digest(variant.digest, `${path}.digest`);
      const serial = integer(variant.serial, `${path}.serial`);
      const editionSize = integer(variant.editionSize, `${path}.editionSize`);
      if (serial > editionSize) throw new TypeError(`${path}.serial must not exceed editionSize`);
      if (seenIds.has(id)) throw new TypeError(`${path}.id duplicates ${id}`);
      seenIds.add(id);
      const serialKey = `${serial}/${editionSize}`;
      if (seenSerials.has(serialKey)) throw new TypeError(`${path} duplicates serial ${serialKey}`);
      seenSerials.add(serialKey);

      const safeWidth = widthMm - 2 * safeMarginMm;
      const safeHeight = heightMm - 2 * safeMarginMm;
      const imageHeight = safeHeight * 0.55;
      const titleHeight = safeHeight * 0.15;
      const detailsHeight = safeHeight * 0.2;
      const numberingHeight = safeHeight * 0.1;
      const x = safeMarginMm;
      return {
        id,
        digest: variantDigest,
        numbering: serialKey,
        title: text(variant.title, `${path}.title`, LIMITS.title),
        subtitle: optionalText(variant.subtitle, `${path}.subtitle`, LIMITS.subtitle),
        body: optionalText(variant.body, `${path}.body`, LIMITS.body),
        attribution: optionalText(variant.attribution, `${path}.attribution`, LIMITS.attribution),
        imageReference: optionalText(variant.imageReference, `${path}.imageReference`, LIMITS.reference),
        trimBox: rect(0, 0, widthMm, heightMm),
        bleedBox: rect(-bleedMm, -bleedMm, widthMm + 2 * bleedMm, heightMm + 2 * bleedMm),
        safeBox: rect(x, safeMarginMm, safeWidth, safeHeight),
        zones: {
          image: rect(x, safeMarginMm, safeWidth, imageHeight),
          title: rect(x, safeMarginMm + imageHeight, safeWidth, titleHeight),
          details: rect(x, safeMarginMm + imageHeight + titleHeight, safeWidth, detailsHeight),
          numbering: rect(x, safeMarginMm + imageHeight + titleHeight + detailsHeight, safeWidth, numberingHeight),
        },
      };
    });

    return {
      outcome: "verified",
      reasons: ["Metadata and printable layout constraints are valid."],
      plan: {
        collectionId,
        collectionDigest,
        provenanceReference,
        print,
        cards,
        notices: [
          "Layout metadata does not grant ownership of trademarks or copyrighted material.",
          "Image references are not fetched, copied, or generated by CardSmith.",
        ],
      },
    };
  } catch (error: unknown) {
    return { outcome: "rejected", reasons: [error instanceof Error ? error.message : "Card metadata is invalid."] };
  }
}
