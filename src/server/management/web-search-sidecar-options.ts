/**
 * The one place that decides which models the management API offers as the
 * web-search sidecar, and which it refuses to persist (#2188).
 *
 * Two routes write `webSearchSidecar.model` — `PUT /api/sidecar-settings`
 * and the `webSearchSidecar` override in `PUT /api/claude-code`. They share
 * this module for the same reason the vision routes share
 * vision-sidecar-options.ts: a gate on one route and a stale copy on the
 * other is the same as no gate at all. `ocx config set` raw JSON writes
 * bypass management gates by design (operator escape hatch, same as vision).
 *
 * Unlike vision's provably-blind gate (reject only on positive proof), the
 * web-search gate is MEMBERSHIP: the executor set is closed and known, so an
 * id outside (candidates ∪ auth slots) can never run and is refused.
 */
import type { OcxConfig } from "../../types";
import { resolveSidecarAuth } from "../../sidecar/auth";
import { pickerVisibleSidecarCandidates, type SidecarCandidate } from "../../sidecar/candidates";
import { isWebSearchAuthSlotModel, webSearchSidecarCandidates } from "../../web-search/backends";

export interface WebSearchModelOption {
  value: string;
  label: string;
  /** True when the row is an auth-slot entitlement rather than a picker row. */
  authSlot?: boolean;
}

/** The candidate rows the web-search executors can actually run right now. */
export async function webSearchCandidateRows(config: OcxConfig): Promise<SidecarCandidate[]> {
  const auth = resolveSidecarAuth(config);
  const all = await pickerVisibleSidecarCandidates(config, auth);
  return webSearchSidecarCandidates(config, auth, all);
}

/**
 * The GUI/CLI option list. The persisted model is display-grandfathered so an
 * operator can SEE a now-illegal setting in the picker (parity with the vision
 * GET); new writes of such an id are still rejected by the gate below.
 */
export function webSearchModelOptionsFrom(
  config: Pick<OcxConfig, "webSearchSidecar">,
  candidates: readonly SidecarCandidate[],
): WebSearchModelOption[] {
  const byValue = new Map<string, WebSearchModelOption>();
  for (const candidate of candidates) {
    if (byValue.has(candidate.id)) continue;
    byValue.set(candidate.id, {
      value: candidate.id,
      label: candidate.id,
      ...(candidate.authSlot ? { authSlot: true } : {}),
    });
  }
  const persisted = config.webSearchSidecar?.model;
  if (persisted && !byValue.has(persisted)) {
    byValue.set(persisted, { value: persisted, label: persisted });
  }
  return [...byValue.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/**
 * Membership gate: reject when the id is neither a runnable candidate nor an
 * auth-slot model. Auth slots pass even when the matching login is currently
 * absent — the slot is a legal setting whose executor simply is not live yet,
 * and refusing it would make settings order-dependent on login state.
 */
export function webSearchModelIsRejected(
  requested: string,
  candidates: readonly SidecarCandidate[],
): boolean {
  if (isWebSearchAuthSlotModel(requested)) return false;
  return !candidates.some(candidate => candidate.id === requested);
}

/** Uniform 400 payload naming the filter, mirroring visionDescriberRejection's shape. */
export function webSearchModelRejection(
  field: string,
  requested: string,
  candidates: readonly SidecarCandidate[],
): { error: string; allowedModels: string[] } {
  return {
    error: `${field}: "${requested}" is not a web-search sidecar candidate — the model must be ` +
      "picker-visible and runnable by an active executor-backed backend (or an auth-slot model)",
    allowedModels: candidates.map(candidate => candidate.id).sort(),
  };
}
