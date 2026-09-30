import { existsSync } from "node:fs";
import path from "node:path";
import { BUNDLE_FILES, DEFAULT_REPO, Laya, defaultCacheDir, ensureBundle } from "@receptron/laya";
import {
  DECISION_ACTIONS,
  ESCALATION_REASONS,
  type DecisionAction,
  type DecisionSignals,
  type EscalationReason,
  type LayaAnswers,
  type LayaStatus,
} from "@/types/decision";
import { LAYA_QUESTIONS, buildLayaState } from "./questions";

/** Laya could not be loaded or could not answer. Callers must show "Laya unavailable", never a made-up decision. */
export class LayaUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LayaUnavailableError";
  }
}

// One ~1.6 GB instance per process, kept on globalThis so Next dev HMR does not load a second copy.
type LayaCache = { promise: Promise<Laya> | null; status: LayaStatus };
const g = globalThis as typeof globalThis & { __gradeguardLaya?: LayaCache };
const cache: LayaCache = (g.__gradeguardLaya ??= { promise: null, status: { state: "not_downloaded" } });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** True when every BUNDLE_FILES entry is in dir. A partial bundle (e.g. interrupted download) is not a bundle. */
export const hasBundle = (dir: string) => BUNDLE_FILES.every((f) => existsSync(path.join(dir, f)));

/** LAYA_MODEL_DIR if set, else the package's default cache dir. */
export const bundleDir = () => process.env.LAYA_MODEL_DIR ?? path.join(defaultCacheDir(), DEFAULT_REPO.replace("/", "--"), "main");

/** bundleDir() when the complete bundle is there, else null. */
function localModelDir(): string | null {
  const dir = bundleDir();
  return hasBundle(dir) ? dir : null;
}

/**
 * Memoized load. A local bundle loads with zero network; otherwise the ~1.6 GB bundle is downloaded first.
 * Each load only touches the cache while it is still the current one (closeLaya can drop it mid-load).
 */
export function loadLaya(): Promise<Laya> {
  if (cache.promise) return cache.promise;
  const current = () => cache.promise === p;
  // Deferred a microtask so `p` is assigned before the body reads it.
  const p: Promise<Laya> = Promise.resolve()
    .then(async () => {
      const started = Date.now();
      let modelDir = localModelDir();
      if (!modelDir) {
        if (process.env.LAYA_MODEL_DIR) throw new Error(`LAYA_MODEL_DIR ${process.env.LAYA_MODEL_DIR} is missing bundle files`);
        if (current()) cache.status = { state: "downloading", receivedBytes: 0, totalBytes: null, file: "" };
        modelDir = await ensureBundle({
          onProgress: ({ file, received, total }) => {
            if (current()) cache.status = { state: "downloading", receivedBytes: received, totalBytes: total, file };
          },
        });
      }
      if (current()) cache.status = { state: "loading" };
      const laya = await Laya.load({ modelDir });
      if (!current()) {
        await laya.close(); // closeLaya ran while this was loading: do not leak a ~1.6 GB session
        throw new Error("Laya was closed while loading");
      }
      cache.status = { state: "ready", modelDir: laya.modelDir, loadMs: Date.now() - started };
      return laya;
    })
    .catch((e: unknown) => {
      if (current()) {
        cache.status = { state: "error", message: message(e) };
        cache.promise = null; // let a later call retry
      }
      throw e;
    });
  cache.promise = p;
  cache.status = { state: "loading" }; // synchronously, so getLayaStatus never reports a stale state for a started load
  return p;
}

/** Current status. Side-effect free: "idle" means the bundle is on disk but nothing has started loading it. */
export function getLayaStatus(): LayaStatus {
  if (!cache.promise && cache.status.state === "not_downloaded" && localModelDir()) return { state: "idle" };
  return cache.status;
}

/** Release the ONNX session and clear the singleton (no-op if not loaded). A later call loads it again. */
export async function closeLaya(): Promise<void> {
  const loading = cache.promise;
  if (!loading) return;
  cache.promise = null; // an in-flight load now sees it is stale and closes its own session
  cache.status = { state: "not_downloaded" }; // reported as "idle" while the bundle is on disk
  await (await loading.catch(() => null))?.close();
}

/** Load (downloading if needed) and resolve once Laya is ready. Rejects with the load error. */
export async function warmLaya(): Promise<void> {
  await loadLaya();
}

function pick<K extends string>(keys: readonly K[], probs: Record<string, number>): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, probs[k] ?? 0])) as Record<K, number>;
}

/** One systemOne call with the three LAYA_QUESTIONS over the compact JSON state. */
export async function askLaya(signals: DecisionSignals): Promise<LayaAnswers> {
  // Grading requests never start the ~1.6 GB download; `pnpm laya:download` does.
  if (!cache.promise && !localModelDir()) {
    throw new LayaUnavailableError("Laya model is not downloaded yet; run `pnpm laya:download`");
  }
  const laya = await loadLaya().catch((e: unknown) => {
    throw new LayaUnavailableError(`Laya failed to load: ${message(e)}`, { cause: e });
  });
  const started = performance.now();
  const r = await laya.systemOne(buildLayaState(signals), LAYA_QUESTIONS).catch((e: unknown) => {
    throw new LayaUnavailableError(`Laya inference failed: ${message(e)}`, { cause: e });
  });
  const latencyMs = Math.round(performance.now() - started);

  const route = pick(DECISION_ACTIONS, r.answers.route.probabilities);
  const reason = pick(ESCALATION_REASONS, r.answers.reason.probabilities);
  return {
    route: { choice: r.answers.route.choice as DecisionAction, probabilities: route },
    accept: { probability: r.answers.accept.noul },
    reason: { choice: r.answers.reason.choice as EscalationReason, probabilities: reason },
    model: r.model,
    inputTokens: r.usage.input_tokens,
    latencyMs,
  };
}
