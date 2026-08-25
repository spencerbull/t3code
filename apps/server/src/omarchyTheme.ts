// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import type { HostTheme, HostThemePalette, HostThemeRefreshResult } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ProcessRunner from "./processRunner.ts";

const RESOLVER_COMMAND = "omarchy-theme-color";
const WATCH_DEBOUNCE = Duration.millis(100);
const UNAVAILABLE_REREAD_DELAY = Duration.millis(50);
const UNAVAILABLE_REREAD_COUNT = 2;
const RESOLVER_TIMEOUT = Duration.seconds(2);
const RESOLVER_MAX_OUTPUT_BYTES = 32 * 1024;
const FLAT_TOML_LINE = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*"([^"\\\r\n]*)"\s*$/;
const RESOLVER_LINE = /^([a-z][a-z0-9_]*)\t([^\t\r\n]+)$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/;

export function omarchyThemeResolverInvocation(colorsPath: string) {
  return {
    command: RESOLVER_COMMAND,
    args: ["--file", colorsPath, "--all"] as const,
  };
}

export interface OmarchyThemePaths {
  readonly currentDir: string;
  readonly colorsPath: string;
  readonly namePath: string;
}

interface OmarchyThemeFileStamp {
  readonly dev: number;
  readonly ino: number | null;
  readonly mtimeMs: number | null;
  readonly size: string;
}

export function isOmarchyThemeMaterializationCoherent(input: {
  readonly nameBefore: OmarchyThemeFileStamp;
  readonly nameAfter: OmarchyThemeFileStamp;
  readonly colorsBefore: OmarchyThemeFileStamp;
  readonly colorsAfter: OmarchyThemeFileStamp;
}): boolean {
  const sameFileGeneration = (
    before: OmarchyThemeFileStamp,
    after: OmarchyThemeFileStamp,
  ): boolean =>
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mtimeMs === after.mtimeMs &&
    before.size === after.size;

  return (
    sameFileGeneration(input.nameBefore, input.nameAfter) &&
    sameFileGeneration(input.colorsBefore, input.colorsAfter) &&
    input.nameAfter.mtimeMs !== null &&
    input.colorsAfter.mtimeMs !== null &&
    input.nameAfter.mtimeMs >= input.colorsAfter.mtimeMs
  );
}

export class OmarchyTheme extends Context.Service<
  OmarchyTheme,
  {
    readonly get: Effect.Effect<Option.Option<HostTheme>>;
    readonly refresh: Effect.Effect<HostThemeRefreshResult>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: Option.Option<HostTheme>;
        readonly changes: Stream.Stream<HostTheme | null>;
      },
      never,
      Scope.Scope
    >;
  }
>()("t3/omarchyTheme") {}

function parseStrictKeyValues(
  input: string,
  linePattern: RegExp,
): Readonly<Record<string, string>> | null {
  const values: Record<string, string> = {};
  for (const rawLine of input.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = linePattern.exec(line);
    if (!match?.[1] || match[2] === undefined || Object.hasOwn(values, match[1])) {
      return null;
    }
    values[match[1]] = match[2];
  }
  return Object.keys(values).length > 0 ? values : null;
}

/** Minimal fallback parser for Omarchy's flat, quoted-string theme files. */
export function parseOmarchyFlatColorsToml(input: string): Readonly<Record<string, string>> | null {
  return parseStrictKeyValues(input, FLAT_TOML_LINE);
}

/** Parser for the canonical resolver's tab-separated `--all` output. */
export function parseOmarchyThemeColorOutput(
  input: string,
): Readonly<Record<string, string>> | null {
  return parseStrictKeyValues(input, RESOLVER_LINE);
}

function canonicalHex(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && HEX_COLOR.test(normalized) ? normalized : null;
}

export function normalizeOmarchyThemePalette(
  values: Readonly<Record<string, string>>,
): HostThemePalette | null {
  const background = canonicalHex(values.background ?? values.bg ?? values.color0);
  const foreground = canonicalHex(values.foreground ?? values.fg ?? values.color7);
  const accent = canonicalHex(values.accent ?? values.blue ?? values.color4);
  const selection = canonicalHex(values.selection ?? values.selection_background ?? values.color8);
  const red = canonicalHex(values.red ?? values.color1);
  const green = canonicalHex(values.green ?? values.color2);
  const yellow = canonicalHex(values.yellow ?? values.color3);
  const blue = canonicalHex(values.blue ?? values.color4);
  const magenta = canonicalHex(values.magenta ?? values.purple ?? values.color5);
  const cyan = canonicalHex(values.cyan ?? values.color6);

  if (
    !background ||
    !foreground ||
    !accent ||
    !selection ||
    !red ||
    !green ||
    !yellow ||
    !blue ||
    !magenta ||
    !cyan
  ) {
    return null;
  }

  return {
    background,
    foreground,
    accent,
    selection,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
  };
}

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function resolveOmarchyThemeAppearance(
  values: Readonly<Record<string, string>>,
  background: string,
): HostTheme["appearance"] {
  const declared = (values.mode ?? values.theme_type)?.trim().toLowerCase();
  if (declared === "light" || declared === "dark") return declared;
  return relativeLuminance(background) < 0.179 ? "dark" : "light";
}

function makeHostTheme(input: {
  readonly name: string;
  readonly values: Readonly<Record<string, string>>;
  readonly colors: HostThemePalette;
}): HostTheme {
  const appearance = resolveOmarchyThemeAppearance(input.values, input.colors.background);
  const revision = NodeCrypto.createHash("sha256")
    .update(JSON.stringify({ name: input.name, appearance, colors: input.colors }))
    .digest("hex");
  return {
    source: "omarchy",
    name: input.name,
    appearance,
    revision,
    colors: input.colors,
  };
}

export function applyOmarchyThemeCandidate(
  current: HostTheme | null,
  candidate: HostTheme | null,
): {
  readonly next: HostTheme | null;
  readonly result: HostThemeRefreshResult;
  readonly publish: HostTheme | null | undefined;
} {
  if (candidate === null) {
    return {
      next: null,
      result: { status: "unavailable" },
      publish: current === null ? undefined : null,
    };
  }
  if (
    current?.revision === candidate.revision &&
    JSON.stringify(current.colors) === JSON.stringify(candidate.colors)
  ) {
    return { next: current, result: { status: "unchanged" }, publish: undefined };
  }
  return { next: candidate, result: { status: "updated" }, publish: candidate };
}

function defaultPaths(path: Path.Path): OmarchyThemePaths {
  const currentDir = path.join(NodeOS.homedir(), ".local", "state", "omarchy", "current");
  return {
    currentDir,
    colorsPath: path.join(currentDir, "theme", "colors.toml"),
    namePath: path.join(currentDir, "theme.name"),
  };
}

const make = (pathsOverride?: OmarchyThemePaths) =>
  Effect.gen(function* () {
    const platform = yield* HostProcessPlatform;
    if (platform !== "linux") {
      return OmarchyTheme.of({
        get: Effect.succeed(Option.none()),
        refresh: Effect.succeed({ status: "unavailable" }),
        subscribe: Effect.succeed({ latest: Option.none(), changes: Stream.empty }),
      });
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const paths = pathsOverride ?? defaultPaths(path);
    const current = yield* Ref.make<HostTheme | null>(null);
    const changes = yield* PubSub.unbounded<HostTheme | null>();
    const refreshMutex = yield* Semaphore.make(1);

    const readFile = (filePath: string) => fs.readFileString(filePath).pipe(Effect.option);
    const readFileStamp = (filePath: string) =>
      fs.stat(filePath).pipe(
        Effect.map(
          (info): OmarchyThemeFileStamp => ({
            dev: info.dev,
            ino: Option.getOrNull(info.ino),
            mtimeMs: Option.match(info.mtime, {
              onNone: () => null,
              onSome: (mtime) => mtime.getTime(),
            }),
            size: String(info.size),
          }),
        ),
        Effect.option,
      );

    const resolveWithInstalledTool = Effect.fn("OmarchyTheme.resolveWithInstalledTool")(
      function* () {
        const invocation = omarchyThemeResolverInvocation(paths.colorsPath);
        const result = yield* processRunner
          .run({
            ...invocation,
            timeout: RESOLVER_TIMEOUT,
            maxOutputBytes: RESOLVER_MAX_OUTPUT_BYTES,
            outputMode: "error",
          })
          .pipe(Effect.option);
        if (
          Option.isNone(result) ||
          result.value.code !== 0 ||
          result.value.stdoutTruncated ||
          result.value.stdoutInvalidUtf8
        ) {
          return Option.none<Readonly<Record<string, string>>>();
        }
        return Option.fromNullishOr(parseOmarchyThemeColorOutput(result.value.stdout));
      },
    );

    const resolveWithTomlFallback = Effect.fn("OmarchyTheme.resolveWithTomlFallback")(function* () {
      const raw = yield* readFile(paths.colorsPath);
      return Option.flatMap(raw, (contents) =>
        Option.fromNullishOr(parseOmarchyFlatColorsToml(contents)),
      );
    });

    const readCandidate = Effect.fn("OmarchyTheme.readCandidate")(function* () {
      const nameBefore = yield* readFileStamp(paths.namePath);
      const colorsBefore = yield* readFileStamp(paths.colorsPath);
      const beforeName = yield* readFile(paths.namePath);
      if (Option.isNone(nameBefore) || Option.isNone(colorsBefore) || Option.isNone(beforeName)) {
        return null;
      }

      const valuesFromTool = yield* resolveWithInstalledTool();
      const values = Option.isSome(valuesFromTool)
        ? valuesFromTool
        : yield* resolveWithTomlFallback();
      if (Option.isNone(values)) return null;

      const afterName = yield* readFile(paths.namePath);
      const nameAfter = yield* readFileStamp(paths.namePath);
      const colorsAfter = yield* readFileStamp(paths.colorsPath);
      if (
        Option.isNone(afterName) ||
        Option.isNone(nameAfter) ||
        Option.isNone(colorsAfter) ||
        beforeName.value !== afterName.value ||
        !isOmarchyThemeMaterializationCoherent({
          nameBefore: nameBefore.value,
          nameAfter: nameAfter.value,
          colorsBefore: colorsBefore.value,
          colorsAfter: colorsAfter.value,
        })
      ) {
        return null;
      }
      const name = afterName.value.trim();
      if (name.length === 0 || name.length > 128) return null;

      const colors = normalizeOmarchyThemePalette(values.value);
      return colors === null ? null : makeHostTheme({ name, values: values.value, colors });
    });

    const readCandidateWithGrace = Effect.fn("OmarchyTheme.readCandidateWithGrace")(function* () {
      for (let rereadsRemaining = UNAVAILABLE_REREAD_COUNT; ; rereadsRemaining -= 1) {
        const candidate = yield* readCandidate();
        if (candidate !== null || rereadsRemaining === 0) return candidate;
        yield* Effect.sleep(UNAVAILABLE_REREAD_DELAY);
      }
    });

    const refresh = refreshMutex.withPermits(1)(
      Effect.gen(function* () {
        const previous = yield* Ref.get(current);
        const candidate =
          previous === null ? yield* readCandidate() : yield* readCandidateWithGrace();
        const transition = applyOmarchyThemeCandidate(previous, candidate);
        if (transition.next !== previous) {
          yield* Ref.set(current, transition.next);
        }
        if (transition.publish !== undefined) {
          yield* PubSub.publish(changes, transition.publish);
        }
        return transition.result;
      }),
    );

    const subscribe = refreshMutex.withPermits(1)(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return {
          latest: Option.fromNullishOr(yield* Ref.get(current)),
          changes: Stream.fromSubscription(subscription),
        };
      }),
    );

    const currentDirExists = yield* fs
      .exists(paths.currentDir)
      .pipe(Effect.orElseSucceed(() => false));
    if (currentDirExists) {
      const watchEvents = yield* Queue.sliding<void, Cause.Done>(1);
      const watcher = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const watcher = NodeFS.watch(paths.currentDir, { recursive: true }, () => {
              Queue.offerUnsafe(watchEvents, undefined);
            });
            watcher.on("error", () => {
              Queue.endUnsafe(watchEvents);
            });
            watcher.on("close", () => {
              Queue.endUnsafe(watchEvents);
            });
            return watcher;
          },
          catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
        }),
        (watcher) => Effect.sync(() => watcher.close()),
      ).pipe(Effect.option);
      if (Option.isSome(watcher)) {
        yield* Stream.fromQueue(watchEvents).pipe(
          Stream.debounce(WATCH_DEBOUNCE),
          Stream.runForEach(() => refresh.pipe(Effect.ignoreCause({ log: true }))),
          Effect.ignoreCause({ log: true }),
          Effect.forkScoped({ startImmediately: true }),
        );
      }
    }

    // The Node watcher is acquired synchronously before this authoritative
    // snapshot, so replacements cannot land in a registration gap.
    yield* refresh;

    return OmarchyTheme.of({
      get: Ref.get(current).pipe(Effect.map(Option.fromNullishOr)),
      refresh,
      subscribe,
    });
  });

export const layer = Layer.effect(OmarchyTheme, make()).pipe(Layer.provide(ProcessRunner.layer));

export const layerForPaths = (paths: OmarchyThemePaths) =>
  Layer.effect(OmarchyTheme, make(paths)).pipe(Layer.provide(ProcessRunner.layer));

export const layerTest = (options?: {
  readonly theme?: HostTheme | null;
  readonly refreshStatus?: HostThemeRefreshResult["status"];
  readonly changes?: Stream.Stream<HostTheme | null>;
}) =>
  Layer.succeed(
    OmarchyTheme,
    OmarchyTheme.of({
      get: Effect.succeed(Option.fromNullishOr(options?.theme ?? null)),
      refresh: Effect.succeed({ status: options?.refreshStatus ?? "unavailable" }),
      subscribe: Effect.succeed({
        latest: Option.fromNullishOr(options?.theme ?? null),
        changes: options?.changes ?? Stream.empty,
      }),
    }),
  );
