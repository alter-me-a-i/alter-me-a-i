/*
 * Fingerprint disclosure gating — the "what the site is allowed to learn about
 * this device" half of defense. A persona that normalizes fingerprints replaces
 * a handful of high-entropy, passively-readable identity signals with common,
 * low-entropy values so you blend into the crowd instead of standing out.
 *
 * This module is PURE — no DOM globals, no extension APIs. It describes the gate
 * plan and applies it to a supplied set of root objects, so it can be unit-tested
 * against fakes and reused in whichever world ends up hosting the override. The
 * caller decides where to run it (the page's MAIN world) and how to report the
 * resulting `disclosure` events into the vault.
 *
 * Conservative by design: only passively-readable, low-breakage signals. No
 * canvas/WebGL noise, no timezone or screen spoofing — those affect rendering
 * and are deliberately out of this first cut.
 */

import type { PersonaProfile } from './personas';

/** A sentinel meaning "make this property unavailable" (e.g. disable an API). */
export const DISABLE = Symbol('cortex.gate.disable');

/** Which root object a gated property lives on. */
export type GateRoot = 'navigator' | 'screen' | 'window';

export interface GateField {
  root: GateRoot;
  /** Property name on the root, e.g. "hardwareConcurrency". */
  prop: string;
  /** Normalized value to expose, or DISABLE to remove the property. */
  value: unknown | typeof DISABLE;
  /** Human label used in the disclosure event's `field`. */
  label: string;
}

/**
 * The conservative gate: common, modal values so the device reads as generic.
 *  - hardwareConcurrency/deviceMemory: 8 — an ordinary mid-range machine.
 *  - platform: "Win32" — the single most common platform string, the best hide.
 *  - maxTouchPoints: 0 — present as a non-touch device.
 *  - getBattery: disabled — the Battery API is pure fingerprinting surface.
 *  - webdriver: false — never advertise automation.
 */
export const CONSERVATIVE_GATE: readonly GateField[] = [
  { root: 'navigator', prop: 'hardwareConcurrency', value: 8, label: 'cpu_cores' },
  { root: 'navigator', prop: 'deviceMemory', value: 8, label: 'device_memory' },
  { root: 'navigator', prop: 'platform', value: 'Win32', label: 'platform' },
  { root: 'navigator', prop: 'maxTouchPoints', value: 0, label: 'max_touch_points' },
  { root: 'navigator', prop: 'getBattery', value: DISABLE, label: 'battery_api' },
  { root: 'navigator', prop: 'webdriver', value: false, label: 'webdriver' },
];

/**
 * Resolve the gate plan for a persona. Empty when the persona doesn't normalize
 * fingerprints (Casual/Open) — so the caller installs nothing and the page sees
 * its real values.
 */
export function buildGatePlan(profile: PersonaProfile): readonly GateField[] {
  return profile.normalizeFingerprint ? CONSERVATIVE_GATE : [];
}

/** Roots an apply targets. Supplied by the caller so this stays DOM-free/testable. */
export interface GateRoots {
  navigator?: Record<string, unknown>;
  screen?: Record<string, unknown>;
  window?: Record<string, unknown>;
}

/**
 * Apply a gate plan by redefining each field on its root. Returns the labels of
 * the fields actually changed — a property that's non-configurable (can't be
 * overridden) is skipped, never throwing, so a single locked-down property never
 * blocks the rest. The returned labels are what the caller records as gated.
 */
export function applyFingerprintGate(
  roots: GateRoots,
  plan: readonly GateField[],
): string[] {
  const gated: string[] = [];
  for (const field of plan) {
    const root = roots[field.root];
    if (!root) continue;
    const ok =
      field.value === DISABLE
        ? defineValue(root, field.prop, undefined)
        : defineValue(root, field.prop, field.value);
    if (ok) gated.push(field.label);
  }
  return gated;
}

/**
 * Define `prop` on `obj` as a non-enumerable getter returning `value`. Returns
 * false (without throwing) if the existing property is non-configurable.
 */
function defineValue(obj: Record<string, unknown>, prop: string, value: unknown): boolean {
  const existing = Object.getOwnPropertyDescriptor(obj, prop);
  if (existing && existing.configurable === false) return false;
  try {
    Object.defineProperty(obj, prop, {
      get: () => value,
      configurable: true,
      enumerable: false,
    });
    return true;
  } catch {
    return false;
  }
}
