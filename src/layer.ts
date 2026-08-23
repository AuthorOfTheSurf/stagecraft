/**
 * v0 of the proposed ergonomic layer over `@rivetkit/effect` — the "dream
 * code" from the wiki design doc (rivet-effect-layer-design), made to run.
 * Every exported name is a PLACEHOLDER; Rivet names things.
 *
 * Level 0 of the disclosure ladder: handlers are plain async functions,
 * payload types live on the handler signature (compile-time safety via the
 * typed client; the wire is trusted — Schema.Any passthrough), errors are
 * declared once and thrown via `fail.X()`, state is a mutable draft
 * committed only when the handler succeeds. Everything compiles down to
 * `Action.make` / `toLayer` / `Schema.TaggedErrorClass` — see the design
 * doc's honesty map.
 */
import { Action, Actor, Client, Registry } from "@rivetkit/effect";
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect";

type AnyHandler = (payload: any, ctx: any) => any;

type EmitOf<Ev> = { [K in keyof Ev]: (payload: Ev[K]) => void };
type FailOf<Er> = { [K in keyof Er]: (fields: Er[K]) => Error };
type PayloadOf<H extends AnyHandler> = Parameters<H>[0];
type ResultOf<H extends AnyHandler> = Awaited<ReturnType<H>>;

/** What a handler receives alongside its payload. */
export interface Ctx<S, Ev, Er> {
  /** Mutable draft of durable state; committed only if the handler succeeds. */
  state: S;
  /** Typed broadcast to connected clients. */
  emit: EmitOf<Ev>;
  /** Schedule a message to this same actor: `self.after(ms).SendMessage(p)`. */
  self: { after: (ms: number) => Record<string, (payload?: any) => void> };
  /** Call another actor: `actors(Moderator).getOrCreate(key).Review(p)`. */
  actors: <W extends AnyActorDef>(other: W) => {
    getOrCreate: (key: string) => ClientMethods<W["__handle"]>;
  };
  /** Typed declared errors: `throw fail.BannedWords({ reason: "…" })`. */
  fail: FailOf<Er>;
  /** Destroy this actor instance. */
  destroy: () => void;
}

type ClientMethods<H extends Record<string, AnyHandler>> = {
  [K in keyof H]: (payload: PayloadOf<H[K]>) => Promise<ResultOf<H[K]>>;
};

type Guards<Er> = {
  [K in keyof Er]: (e: unknown) => e is Er[K] & { _tag: K };
};

export interface AnyActorDef {
  readonly __name: string;
  readonly __handle: Record<string, AnyHandler>;
  readonly contract: any;
  readonly live: Layer.Layer<never, never, any>;
  readonly is: Record<string, (e: unknown) => boolean>;
}

export interface ActorDef<
  S,
  Ev,
  Er,
  H extends Record<string, AnyHandler>,
> extends AnyActorDef {
  readonly __handle: H;
  readonly is: Guards<Er>;
}

// Generated error classes, shared across all actors in the module so a
// callee's error can flow through a caller's channel (v0 simplification:
// every action declares the union of every registered error).
const errorClasses = new Map<string, any>();
const errorUnion = () =>
  errorClasses.size > 0
    ? Schema.Union([...errorClasses.values()])
    : undefined;

// Declared-error data is flattened onto an Error instance (see `flatten`),
// so these field names would silently clobber built-in Error props.
const RESERVED_ERROR_FIELDS = new Set([
  "name",
  "message",
  "stack",
  "cause",
  "_tag",
]);

const isDeclaredError = (e: unknown): e is { _tag: string; data: any } =>
  typeof e === "object" && e !== null && "_tag" in e &&
  errorClasses.has((e as any)._tag);

/** Flatten a wire error class instance into the dream-surface shape. */
const flatten = (e: { _tag: string; data: any }) =>
  Object.assign(new Error(e._tag), { _tag: e._tag, ...(e.data ?? {}) });

// ---------------------------------------------------------------------------
// The unexpected-error channel ("Part 2"): any failure a handler did NOT
// declare is caught at the handler boundary, turned into a context-rich
// report (enough for a coding agent to produce the patch), pushed to every
// subscribed reporter, and crosses the wire as a single typed
// `UnexpectedError` — the actor survives and its state draft is discarded.
// In-process subscription is the v0 stand-in for the real sink (Rivet's
// pending actor onError hook / a Sentry exporter).
// ---------------------------------------------------------------------------

export type UnexpectedReport = {
  reportId: string;
  actor: string;
  /** Instance key (multi-part keys joined with "/"); "" for keyless actors. */
  key: string;
  action: string;
  payload: unknown;
  /** Committed state at the moment the handler ran (draft changes excluded). */
  state: unknown;
  error: { name: string; message: string; stack?: string };
  at: number;
};

const reporters = new Set<(r: UnexpectedReport) => void>();

/** Subscribe to unexpected-error reports; returns an unsubscribe fn. */
export function onUnexpected(fn: (r: UnexpectedReport) => void): () => void {
  reporters.add(fn);
  return () => void reporters.delete(fn);
}

// Activity channel: every handled action emits one event (ok / declared
// error / unexpected error). A liveness watchdog or live panel consumes
// these — silent actors become visible by the *absence* of events.
export type ActivityEvent = {
  actor: string;
  /** Instance key (multi-part keys joined with "/"); "" for keyless actors. */
  key: string;
  action: string;
  outcome: "ok" | "declared-error" | "unexpected-error";
  ms: number;
  at: number;
};

const activityListeners = new Set<(ev: ActivityEvent) => void>();

/** Subscribe to per-action activity events; returns an unsubscribe fn. */
export function onActivity(fn: (ev: ActivityEvent) => void): () => void {
  activityListeners.add(fn);
  return () => void activityListeners.delete(fn);
}

const notifyActivity = (ev: ActivityEvent) => {
  for (const fn of activityListeners) {
    try { fn(ev); } catch { /* a broken listener must not break the actor */ }
  }
};

const UNEXPECTED = "UnexpectedError";
errorClasses.set(
  UNEXPECTED,
  class extends Schema.TaggedErrorClass<any>()(UNEXPECTED, { data: Schema.Any }) {},
);

export const isUnexpected = (
  e: unknown,
): e is Error & {
  _tag: typeof UNEXPECTED;
  reportId: string;
  actor: string;
  action: string;
} =>
  typeof e === "object" && e !== null && (e as any)._tag === UNEXPECTED;

/**
 * Production knobs for one actor. `@rivetkit/effect` forwards only `name` and
 * `icon` to rivetkit today, so anything else set through its own option bag is
 * silently dropped — which is how an actor that awaits an LLM ends up killed by
 * the 60s default `actionTimeout` with no way to say otherwise. We apply these
 * to the underlying rivetkit actor ourselves, after its layer is built and
 * before the registry starts. See stagecraft#19; this goes away if upstream
 * widens its passthrough.
 */
export type RuntimeOptions = {
  /** Max wall-clock ms for ONE action, including everything it awaits. Default 60_000. */
  actionTimeout?: number;
  /** Keep the instance awake instead of sleeping when idle. Default false. */
  noSleep?: number | boolean;
  /** Idle ms before the instance sleeps. Default 30_000. */
  sleepTimeout?: number;
  /** Max bytes for one inbound action payload. Default 65_536. */
  maxQueueMessageSize?: number;
} & Record<string, unknown>;

export function actor<
  S extends object,
  Ev extends Record<string, any>,
  Er extends Record<string, any>,
  H extends Record<string, (payload: any, ctx: Ctx<S, Ev, Er>) => any>,
>(
  name: string,
  config: { state: S; events?: Ev; errors?: Er; handle: H; options?: RuntimeOptions },
): ActorDef<S, Ev, Er, H> {
  for (const tag of Object.keys(config.errors ?? {})) {
    if (!errorClasses.has(tag)) {
      errorClasses.set(
        tag,
        class extends Schema.TaggedErrorClass<any>()(tag, { data: Schema.Any }) {},
      );
    }
  }

  const actionNames = Object.keys(config.handle);
  const actions = actionNames.map((tag) => {
    const err = errorUnion();
    return Action.make(tag, {
      payload: { data: Schema.Any },
      success: Schema.Any,
      ...(err ? { error: err } : {}),
    });
  });
  const contract = Actor.make(name, { actions: actions as any });

  const fail = new Proxy({} as FailOf<Er>, {
    get: (_, tag: string) => (fields: any) => {
      const Cls = errorClasses.get(tag);
      if (!Cls) throw new Error(`undeclared error: ${tag}`);
      for (const key of Object.keys(fields ?? {})) {
        if (RESERVED_ERROR_FIELDS.has(key)) {
          throw new Error(
            `declared error ${tag} uses reserved field "${key}" — ` +
              `error data is flattened onto an Error instance, so ` +
              `${[...RESERVED_ERROR_FIELDS].join("/")} would collide with ` +
              `built-in props. Rename the field.`,
          );
        }
      }
      return new Cls({ data: fields ?? {} });
    },
  });

  const built = contract.toLayer(
    Effect.fnUntraced(function* ({ rawRivetkitContext, state }: any) {
      // Which instance this is — a fleet of same-named actors is the normal
      // case, and every monitor channel event must say WHICH one spoke.
      const instanceKey: string = (rawRivetkitContext.key ?? []).join("/");
      // The SDK runs actions concurrently; level 0 promises the actor-model
      // semantic instead — one handler at a time per instance — which is
      // also what makes the read-clone-commit state draft safe.
      let chain: Promise<unknown> = Promise.resolve();
      const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
        const next = chain.then(fn, fn);
        chain = next.catch(() => undefined);
        return next;
      };
      const makeCtx = (draft: S, run: <A>(e: Effect.Effect<A, any, any>) => Promise<A>): Ctx<S, Ev, Er> => ({
        state: draft,
        emit: new Proxy({} as EmitOf<Ev>, {
          get: (_, event: string) => (payload: any) =>
            rawRivetkitContext.broadcast(event, payload),
        }),
        self: {
          after: (ms: number) =>
            new Proxy({}, {
              get: (_, action: string) => (payload?: any) =>
                rawRivetkitContext.schedule.after(ms, action, { data: payload }),
            }),
        },
        actors: (other: AnyActorDef) => ({
          getOrCreate: (key: string) =>
            new Proxy({} as any, {
              get: (_, method: string) => async (payload: any) => {
                const accessor: any = await run(other.contract.client);
                const handle = accessor.getOrCreate(key);
                const outcome = await run(
                  Effect.result(handle[method]({ data: payload })),
                );
                if (Result.isFailure(outcome)) throw outcome.failure;
                return outcome.success;
              },
            }),
        }),
        fail,
        destroy: () => rawRivetkitContext.destroy(),
      });

      const handlers: any = {};
      for (const tag of actionNames) {
        handlers[tag] = ({ payload }: any) =>
          Effect.flatMap(Effect.context<never>(), (actionContext) => {
          const run = Effect.runPromiseWith(actionContext);
          return Effect.tryPromise({
            try: () => serialize(async () => {
              const t0 = Date.now();
              const activity = (outcome: ActivityEvent["outcome"]) =>
                notifyActivity({ actor: name, key: instanceKey, action: tag, outcome, ms: Date.now() - t0, at: Date.now() });
              const current = await run(state.get.pipe(Effect.orDie));
              const draft = JSON.parse(JSON.stringify(current ?? {})) as S;
              let result: unknown;
              try {
                result = await config.handle[tag]!(payload?.data, makeCtx(draft, run as any));
              } catch (e) {
                if (isDeclaredError(e)) {
                  activity("declared-error");
                  throw e;
                }
                const err = e instanceof Error ? e : new Error(String(e));
                const report: UnexpectedReport = {
                  reportId: crypto.randomUUID(),
                  actor: name,
                  key: instanceKey,
                  action: tag,
                  payload: payload?.data,
                  state: current,
                  error: { name: err.name, message: err.message, stack: err.stack },
                  at: Date.now(),
                };
                for (const fn of reporters) {
                  try { fn(report); } catch { /* a broken reporter must not mask the report */ }
                }
                activity("unexpected-error");
                const Cls = errorClasses.get(UNEXPECTED)!;
                throw new Cls({
                  data: {
                    reportId: report.reportId,
                    actor: name,
                    action: tag,
                    message: err.message,
                  },
                });
              }
              await run(state.update(() => draft).pipe(Effect.orDie));
              activity("ok");
              return result;
            }),
            catch: (e) => e,
          }).pipe(
            Effect.catch((e: unknown) =>
              isDeclaredError(e) ? Effect.fail(e as never) : Effect.die(e),
            ),
          );
          });
      }
      return contract.of(handlers);
    }) as any,
    {
      state: {
        schema: Schema.Any,
        initialValue: () => config.state,
      },
      name,
    } as any,
  );

  // Apply the runtime knobs by hand (see RuntimeOptions). `toLayer` registers
  // the built rivetkit actor on the Registry; we reach for it there and write
  // the options onto its parsed config. This runs after the actor's own layer
  // is built and before `Registry.test`/`serve` reads the config to start, so
  // the values are in place by the time they matter.
  const live = config.options
    ? Layer.effectDiscard(
        Effect.gen(function* () {
          const registry = yield* Registry.Registry;
          const built = (registry as any).rivetkitActors?.get(name);
          if (!built?.config?.options) {
            // Upstream moved the shape out from under us. Say so loudly rather
            // than run a fleet under limits nobody asked for.
            throw new Error(
              `actor ${name}: cannot apply options — @rivetkit/effect no longer ` +
                `exposes the built rivetkit actor's config. Remove the options, ` +
                `or update stagecraft.`,
            );
          }
          Object.assign(built.config.options, config.options);
        }),
      ).pipe(Layer.provideMerge(built))
    : built;

  const is = new Proxy({} as Guards<Er>, {
    get: (_, tag: string) => (e: unknown) =>
      typeof e === "object" && e !== null && (e as any)._tag === tag,
  });

  return { __name: name, __handle: config.handle, contract, live, is };
}

/**
 * One-line test/dev engine: boots a real local rivet-engine for the given
 * actors and hands back plain-promise typed clients. The wrapper for
 * `Registry.test` + Layer wiring + ManagedRuntime.
 */
export function testEngine(...defs: (AnyActorDef | Layer.Layer<never, never, any>)[]) {
  // Raw @rivetkit/effect layers may ride along with wrapped actors — one
  // engine + one registry per process, because two Registry.test instances
  // against the same engine clobber each other's actor registrations.
  const lives = defs.map((d) => (Layer.isLayer(d) ? d : (d as AnyActorDef).live));
  const ActorsLayer = Layer.mergeAll(...(lives as [any])).pipe(
    Layer.provide(Client.layer()),
  ) as unknown as Layer.Layer<never>;
  const TestLayer = Registry.test.pipe(
    Layer.provideMerge(ActorsLayer),
    Layer.provide(Registry.layer()),
  );
  const runtime = ManagedRuntime.make(TestLayer);

  return {
    client<W extends AnyActorDef>(def: W) {
      return {
        getOrCreate: (key: string): ClientMethods<W["__handle"]> =>
          new Proxy({} as any, {
            get: (_, method: string) => async (payload?: any) => {
              const accessor: any = await runtime.runPromise(def.contract.client);
              const handle = accessor.getOrCreate(key);
              const outcome = await runtime.runPromise(
                Effect.result(handle[method]({ data: payload })),
              );
              if (Result.isFailure(outcome)) {
                const e = outcome.failure;
                throw isDeclaredError(e) ? flatten(e) : e;
              }
              return outcome.success;
            },
          }),
      };
    },
    /** Run a raw Effect against this engine's runtime (for raw-SDK suites). */
    run: <A, E>(effect: Effect.Effect<A, E, any>) => runtime.runPromise(effect as any) as Promise<A>,
    dispose: () => runtime.dispose(),
  };
}
