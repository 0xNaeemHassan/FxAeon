import { isAddress, type Address } from "viem";
import { OFFICIAL_FX_METHODS, type FxChainId, type OfficialFxMethod } from "./types";

/**
 * A signature-required draft is only a local resume hint. It intentionally
 * stores no calldata, quote, nonce, recipient, or transaction request. The
 * action must be rebuilt and simulated from current inputs before signing.
 */
export type SignatureDraftStatus = "signature-required" | "cancelled";

/**
 * Safe, UI-only state that can help a product restore an unsigned form after
 * navigation. Values are deliberately limited to primitives; executable
 * calldata, quote objects, nonces, and transaction requests never belong in a
 * signature draft.
 */
export type SignatureDraftStateValue = string | number | boolean | null;
export type SignatureDraftState = Readonly<Record<string, SignatureDraftStateValue>>;

export interface SignatureRequiredDraft {
  id: string;
  walletAddress: Address;
  chainId: FxChainId;
  operation: OfficialFxMethod;
  /** Caller-provided stable action identity, never executable data. */
  actionKey: string;
  /** Same-origin path (including query) to reopen the exact flow. */
  resumePath: string;
  /** Optional primitive-only form snapshot; never a route or transaction. */
  formState?: SignatureDraftState;
  createdAt: number;
  updatedAt: number;
  status: SignatureDraftStatus;
}

/**
 * The identity a route must prove before it can restore a local draft. Keep
 * this scope explicit: a browser may contain drafts for several accounts,
 * chains, and product actions at the same time.
 */
export type SignatureDraftScope = Pick<
  SignatureRequiredDraft,
  "walletAddress" | "chainId" | "operation" | "actionKey"
>;

export interface RestoredSignatureDraft {
  draft: SignatureRequiredDraft;
  /** A fresh copy of primitive UI state; callers must validate each field. */
  formState: SignatureDraftState;
}

const STORAGE_KEY = "fxaeon:signature-drafts:v1";
const MAX_DRAFTS = 32;
const MAX_FORM_STATE_KEYS = 48;
const MAX_FORM_STATE_BYTES = 4_096;
const FORBIDDEN_FORM_STATE_KEY = /(calldata|transaction|nonce|quote|signature|private|secret|seed|route|request|hash)/i;
let memoryDrafts: SignatureRequiredDraft[] = [];
let storageUnavailable = false;

function validPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && value.startsWith("/")
    && !value.startsWith("//")
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !/^[a-z][a-z\d+.-]*:/i.test(value);
}

function normalizeFormState(value: unknown): SignatureDraftState | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_FORM_STATE_KEYS) return undefined;
  const normalized: Record<string, SignatureDraftStateValue> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || FORBIDDEN_FORM_STATE_KEY.test(key)) return undefined;
    if (typeof item === "string") {
      if (item.length > 512) return undefined;
      // Addresses are useful UI state; longer hex blobs are typically calldata,
      // hashes, or encoded route data and are never valid form inputs here.
      if (item.length > 42 && /^0x[0-9a-f]+$/i.test(item)) return undefined;
      normalized[key] = item;
    } else if (typeof item === "number") {
      if (!Number.isFinite(item) || !Number.isSafeInteger(item)) return undefined;
      normalized[key] = item;
    } else if (typeof item === "boolean" || item === null) {
      normalized[key] = item;
    } else {
      return undefined;
    }
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_FORM_STATE_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return Object.freeze(normalized);
}

function validDraft(value: unknown): value is SignatureRequiredDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SignatureRequiredDraft>;
  if (
    typeof draft.id !== "string"
    || draft.id.length > 512
    || typeof draft.walletAddress !== "string"
    || !isAddress(draft.walletAddress)
    || (draft.chainId !== 1 && draft.chainId !== 8453)
    || typeof draft.operation !== "string"
    || !(OFFICIAL_FX_METHODS as readonly string[]).includes(draft.operation)
    || typeof draft.actionKey !== "string"
    || draft.actionKey.length === 0
    || draft.actionKey.length > 160
    || !/^[\x20-\x7e]+$/.test(draft.actionKey)
    || !validPath(draft.resumePath)
    || typeof draft.createdAt !== "number"
    || !Number.isFinite(draft.createdAt)
    || typeof draft.updatedAt !== "number"
    || !Number.isFinite(draft.updatedAt)
    || draft.updatedAt < draft.createdAt
    || (draft.status !== "signature-required" && draft.status !== "cancelled")
  ) return false;

  const formState = normalizeFormState(draft.formState);
  if (draft.formState !== undefined && !formState) return false;

  // Reconstruct the identity only after all required fields have been
  // narrowed. This rejects hand-edited localStorage records without unsafe
  // casts or accepting a draft under a different action identity.
  return draft.id === signatureDraftId({
    walletAddress: draft.walletAddress,
    chainId: draft.chainId,
    operation: draft.operation,
    actionKey: draft.actionKey,
    resumePath: draft.resumePath,
  });
}

function getStorage(): Storage | undefined {
  if (typeof window === "undefined" || storageUnavailable) return undefined;
  try {
    return window.localStorage;
  } catch {
    storageUnavailable = true;
    return undefined;
  }
}

function readStored(): SignatureRequiredDraft[] {
  const target = getStorage();
  if (!target) return [...memoryDrafts];
  try {
    const parsed: unknown = JSON.parse(target.getItem(STORAGE_KEY) ?? "[]");
    const stored = Array.isArray(parsed) ? parsed.filter(validDraft) : [];
    const byId = new Map<string, SignatureRequiredDraft>();
    for (const draft of [...stored, ...memoryDrafts]) {
      const previous = byId.get(draft.id);
      if (!previous || draft.updatedAt >= previous.updatedAt) byId.set(draft.id, draft);
    }
    memoryDrafts = [...byId.values()].sort((left, right) => left.updatedAt - right.updatedAt).slice(-MAX_DRAFTS);
    return [...memoryDrafts];
  } catch {
    storageUnavailable = true;
    return [...memoryDrafts];
  }
}

function writeStored(drafts: readonly SignatureRequiredDraft[]): void {
  memoryDrafts = [...drafts].slice(-MAX_DRAFTS);
  const target = getStorage();
  if (!target) return;
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(memoryDrafts));
  } catch {
    storageUnavailable = true;
  }
}

export function signatureDraftId(params: Pick<SignatureRequiredDraft, "walletAddress" | "chainId" | "operation" | "actionKey" | "resumePath">): string {
  return `${params.chainId}:${params.walletAddress.toLowerCase()}:${params.operation}:${encodeURIComponent(params.actionKey)}:${encodeURIComponent(params.resumePath)}`;
}

export function readSignatureRequiredDrafts(walletAddress?: string): SignatureRequiredDraft[] {
  const drafts = readStored();
  if (!walletAddress || !isAddress(walletAddress)) return drafts;
  return drafts.filter((draft) => draft.walletAddress.toLowerCase() === walletAddress.toLowerCase());
}

/** Read one draft without exposing unscoped local records to a route. */
export function readSignatureRequiredDraft(id: string): SignatureRequiredDraft | undefined {
  if (typeof id !== "string" || id.length === 0 || id.length > 512) return undefined;
  return readStored().find((draft) => draft.id === id && draft.status === "signature-required");
}

/** Extract the opaque local-draft id from a route query without trusting any
 * other query value. This is safe to call during SSR or in a browser. */
export function signatureDraftIdFromSearch(search: string): string | undefined {
  if (typeof search !== "string" || search.length > 2_048) return undefined;
  try {
    const id = new URLSearchParams(search).get("fxDraft") ?? undefined;
    return id && id.length > 0 && id.length <= 512 ? id : undefined;
  } catch {
    return undefined;
  }
}

function sameDraftScope(draft: SignatureRequiredDraft, scope: SignatureDraftScope): boolean {
  return draft.walletAddress.toLowerCase() === scope.walletAddress.toLowerCase()
    && draft.chainId === scope.chainId
    && draft.operation === scope.operation
    && draft.actionKey === scope.actionKey;
}

/**
 * Restore only a signature-required draft that matches the exact current
 * wallet, chain, operation, and action key. The returned form state contains
 * primitives only and is intentionally not a prepared route or transaction.
 */
export function restoreSignatureRequiredDraft(
  id: string,
  scope: SignatureDraftScope,
): RestoredSignatureDraft | undefined {
  if (!isAddress(scope.walletAddress)) return undefined;
  const draft = readSignatureRequiredDraft(id);
  if (!draft || !sameDraftScope(draft, scope)) return undefined;
  return {
    draft,
    formState: Object.freeze({ ...(draft.formState ?? {}) }),
  };
}

/**
 * Convenience adapter for product routes. It combines the query extraction
 * with the strict wallet/network/operation/action scope check, so a copied
 * or stale resume link simply yields no draft and the route stays editable.
 */
export function restoreSignatureRequiredDraftFromSearch(
  search: string,
  scope: SignatureDraftScope,
): RestoredSignatureDraft | undefined {
  const id = signatureDraftIdFromSearch(search);
  return id ? restoreSignatureRequiredDraft(id, scope) : undefined;
}

/**
 * Add the local draft id to a same-origin resume link. The stored path stays
 * clean and stable, while a route can use the id to restore and revalidate the
 * exact primitive form snapshot before rebuilding its plan.
 */
export function signatureDraftResumePath(draft: Pick<SignatureRequiredDraft, "id" | "resumePath">): string {
  if (!validPath(draft.resumePath) || typeof draft.id !== "string" || draft.id.length === 0) return "/history";
  try {
    const url = new URL(draft.resumePath, "https://fxaeon.local");
    url.searchParams.set("fxDraft", draft.id);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/history";
  }
}

export function saveSignatureRequiredDraft(params: {
  walletAddress: Address;
  chainId: FxChainId;
  operation: OfficialFxMethod;
  actionKey: string;
  resumePath: string;
  formState?: SignatureDraftState;
}): SignatureRequiredDraft {
  if (!validPath(params.resumePath)) throw new Error("signature draft route must be a same-origin path");
  if (!/^[\x20-\x7e]{1,160}$/.test(params.actionKey)) throw new Error("signature draft action key is invalid");
  const formState = normalizeFormState(params.formState);
  if (params.formState !== undefined && !formState) throw new Error("signature draft form state is invalid");
  const drafts = readStored();
  const id = signatureDraftId(params);
  const previous = drafts.find((draft) => draft.id === id);
  const now = Date.now();
  const draft: SignatureRequiredDraft = {
    id,
    walletAddress: params.walletAddress,
    chainId: params.chainId,
    operation: params.operation,
    actionKey: params.actionKey,
    resumePath: params.resumePath,
    ...(formState ? { formState } : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    status: "signature-required",
  };
  writeStored([...drafts.filter((candidate) => candidate.id !== id), draft]);
  return draft;
}

export function cancelSignatureRequiredDraft(id: string): void {
  const drafts = readStored();
  const target = drafts.find((draft) => draft.id === id);
  if (!target || target.status === "cancelled") return;
  writeStored(drafts.map((draft) => draft.id === id ? { ...draft, status: "cancelled", updatedAt: Math.max(Date.now(), draft.updatedAt + 1) } : draft));
}

/** Remove a draft once its fresh route has actually been submitted. */
export function removeSignatureRequiredDraft(id: string): void {
  const drafts = readStored();
  if (drafts.some((draft) => draft.id === id)) writeStored(drafts.filter((draft) => draft.id !== id));
}

export function clearSignatureDraftsForTests(): void {
  memoryDrafts = [];
  storageUnavailable = false;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* browser-less tests */ }
}
