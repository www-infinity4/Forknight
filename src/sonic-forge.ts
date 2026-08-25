import type { Outcome } from "./types";

export interface AudioMetrics {
  frequencyBins: number[];
  rms: number;
  peak: number;
}

export interface VisualParameters {
  energy: number;
  glow: number;
  motion: number;
  hueDegrees: number;
  normalizedBars: number[];
}

export interface AudioVisualResult {
  outcome: Outcome;
  reasons: string[];
  parameters?: VisualParameters;
}

function bounded(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function mapAudioMetrics(metrics: AudioMetrics): AudioVisualResult {
  if (metrics.frequencyBins.length === 0 || metrics.frequencyBins.length > 256) {
    return { outcome: "rejected", reasons: ["frequency-bin-count-out-of-range"] };
  }
  const values = [...metrics.frequencyBins, metrics.rms, metrics.peak];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    return { outcome: "rejected", reasons: ["audio-metric-out-of-range"] };
  }

  const energy = metrics.frequencyBins.reduce((sum, value) => sum + value, 0) / metrics.frequencyBins.length;
  return {
    outcome: "verified",
    reasons: [],
    parameters: {
      energy,
      glow: bounded(metrics.peak),
      motion: bounded((energy + metrics.rms) / 2),
      hueDegrees: Math.round(bounded(metrics.rms) * 359),
      normalizedBars: metrics.frequencyBins.map((value) => bounded(value))
    }
  };
}
