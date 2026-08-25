import type { Outcome } from "./types";

const MAX_SAFE_VOLTAGE_VOLTS = 24;
const MAX_SAFE_CURRENT_AMPS = 2;
const MAX_SAFE_RESISTOR_POWER_WATTS = 24;
const MIN_RESISTANCE_OHMS = 1;
const MAX_RESISTANCE_OHMS = 1_000_000;
const MIN_CAPACITANCE_FARADS = 1e-9;
const MAX_CAPACITANCE_FARADS = 1;
const MAX_ELAPSED_SECONDS = 3_600;

export interface OhmSimulatorResult {
  outcome: Outcome;
  reasons: string[];
  output?: OhmSimulatorOutput;
}

export interface OhmSimulatorOutput {
  circuit: "resistive-dc" | "rc-dc";
  sourceVoltageVolts: number;
  resistanceOhms: number;
  currentAmps: number;
  resistorPowerWatts: number;
  capacitorVoltageVolts?: number;
  capacitanceFarads?: number;
  timeConstantSeconds?: number;
  capacitorEnergyJoules?: number;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function rejected(reason: string): OhmSimulatorResult {
  return { outcome: "rejected", reasons: [reason] };
}

function validateCurrentAndPower(
  currentMagnitudeAmps: number,
  resistanceOhms: number,
): OhmSimulatorResult | undefined {
  if (currentMagnitudeAmps > MAX_SAFE_CURRENT_AMPS) {
    return rejected("circuit.current-out-of-safe-range");
  }

  if (
    currentMagnitudeAmps * currentMagnitudeAmps * resistanceOhms >
    MAX_SAFE_RESISTOR_POWER_WATTS
  ) {
    return rejected("circuit.power-out-of-safe-range");
  }

  return undefined;
}

export function simulateOhmCircuit(input: unknown): OhmSimulatorResult {
  if (!isRecord(input)) return rejected("input.invalid");

  const source = input["source"];
  if (!isRecord(source) || source["kind"] !== "dc") {
    return rejected("source.dc-only");
  }

  const sourceVoltage = source["voltageVolts"];
  if (!finiteInRange(sourceVoltage, 0, MAX_SAFE_VOLTAGE_VOLTS)) {
    return rejected("source.voltage-out-of-safe-range");
  }

  const circuit = input["circuit"];
  if (!isRecord(circuit)) return rejected("circuit.invalid");

  const resistance = circuit["resistanceOhms"];
  if (!finiteInRange(resistance, MIN_RESISTANCE_OHMS, MAX_RESISTANCE_OHMS)) {
    return rejected("circuit.resistance-out-of-range");
  }

  if (circuit["kind"] === "resistive") {
    const current = sourceVoltage / resistance;
    const unsafe = validateCurrentAndPower(current, resistance);
    if (unsafe !== undefined) return unsafe;

    return {
      outcome: "verified",
      reasons: [],
      output: {
        circuit: "resistive-dc",
        sourceVoltageVolts: sourceVoltage,
        resistanceOhms: resistance,
        currentAmps: current,
        resistorPowerWatts: current * current * resistance,
      },
    };
  }

  if (circuit["kind"] !== "rc") return rejected("circuit.unsupported");

  const capacitance = circuit["capacitanceFarads"];
  if (!finiteInRange(capacitance, MIN_CAPACITANCE_FARADS, MAX_CAPACITANCE_FARADS)) {
    return rejected("circuit.capacitance-out-of-range");
  }

  const elapsed = circuit["elapsedSeconds"];
  if (!finiteInRange(elapsed, 0, MAX_ELAPSED_SECONDS)) {
    return rejected("circuit.elapsed-time-out-of-range");
  }

  const initialVoltage = circuit["initialCapacitorVoltageVolts"];
  if (!finiteInRange(initialVoltage, 0, MAX_SAFE_VOLTAGE_VOLTS)) {
    return rejected("circuit.initial-voltage-out-of-safe-range");
  }

  const initialCurrentMagnitude =
    Math.abs(sourceVoltage - initialVoltage) / resistance;
  const unsafe = validateCurrentAndPower(initialCurrentMagnitude, resistance);
  if (unsafe !== undefined) return unsafe;

  const timeConstant = resistance * capacitance;
  const capacitorVoltage =
    sourceVoltage +
    (initialVoltage - sourceVoltage) * Math.exp(-elapsed / timeConstant);
  const current = (sourceVoltage - capacitorVoltage) / resistance;

  return {
    outcome: "verified",
    reasons: [],
    output: {
      circuit: "rc-dc",
      sourceVoltageVolts: sourceVoltage,
      resistanceOhms: resistance,
      capacitanceFarads: capacitance,
      timeConstantSeconds: timeConstant,
      capacitorVoltageVolts: capacitorVoltage,
      currentAmps: current,
      resistorPowerWatts: current * current * resistance,
      capacitorEnergyJoules:
        0.5 * capacitance * capacitorVoltage * capacitorVoltage,
    },
  };
}
