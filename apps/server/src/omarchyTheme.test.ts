import * as NodeServices from "@effect/platform-node/NodeServices";
import type { HostTheme } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  OmarchyTheme,
  applyOmarchyThemeCandidate,
  isOmarchyThemeMaterializationCoherent,
  normalizeOmarchyThemePalette,
  omarchyThemeResolverInvocation,
  parseOmarchyFlatColorsToml,
  parseOmarchyThemeColorOutput,
  resolveOmarchyThemeAppearance,
  layerForPaths,
} from "./omarchyTheme.ts";

const flatColors = `
# Current Omarchy files are flat quoted values.
mode = "dark"
accent = "#BD93F9"
selection = "#44475a"
background = "#282a36"
foreground = "#f8f8f2"
color0 = "#282a36"
color1 = "#ff5555"
color2 = "#50fa7b"
color3 = "#f1fa8c"
color4 = "#bd93f9"
color5 = "#ff79c6"
color6 = "#8be9fd"
color7 = "#f8f8f2"
color8 = "#6272a4"
hyprland_active_border = "rgba(8a8588ee) rgba(e2dddcee)"
`;

const expectedPalette = {
  background: "#282a36",
  foreground: "#f8f8f2",
  accent: "#bd93f9",
  selection: "#44475a",
  red: "#ff5555",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  blue: "#bd93f9",
  magenta: "#ff79c6",
  cyan: "#8be9fd",
} as const;

const theme = (revision: string, accent = "#bd93f9"): HostTheme => ({
  source: "omarchy",
  name: "Dracula",
  appearance: "dark",
  revision,
  colors: { ...expectedPalette, accent },
});

describe("Omarchy theme parsing", () => {
  it("parses and normalizes the current flat colors.toml shape", () => {
    const parsed = parseOmarchyFlatColorsToml(flatColors);
    expect(parsed).not.toBeNull();
    expect(normalizeOmarchyThemePalette(parsed!)).toEqual(expectedPalette);
  });

  it("rejects TOML features outside the strict flat fallback", () => {
    expect(parseOmarchyFlatColorsToml('[colors]\naccent = "#ffffff"')).toBeNull();
    expect(parseOmarchyFlatColorsToml("accent = '#ffffff'")).toBeNull();
    expect(parseOmarchyFlatColorsToml('accent = "#ffffff"\naccent = "#000000"')).toBeNull();
  });

  it("accepts non-palette quoted values while validating semantic colors separately", () => {
    const parsed = parseOmarchyFlatColorsToml(flatColors);
    expect(parsed).toMatchObject({
      mode: "dark",
      hyprland_active_border: "rgba(8a8588ee) rgba(e2dddcee)",
    });
    expect(resolveOmarchyThemeAppearance(parsed!, expectedPalette.background)).toBe("dark");
    expect(normalizeOmarchyThemePalette(parsed!)).toEqual(expectedPalette);
  });

  it("normalizes canonical resolver output and honors its declared mode", () => {
    const parsed = parseOmarchyThemeColorOutput(
      [
        "accent\t#bd93f9",
        "background\t#f8f8f2",
        "foreground\t#282a36",
        "selection\t#e2e8f0",
        "red\t#ff5555",
        "green\t#50fa7b",
        "yellow\t#f1fa8c",
        "blue\t#bd93f9",
        "magenta\t#ff79c6",
        "cyan\t#8be9fd",
        "mode\tlight",
      ].join("\n"),
    );
    expect(parsed).not.toBeNull();
    expect(resolveOmarchyThemeAppearance(parsed!, "#f8f8f2")).toBe("light");
  });

  it("invokes the installed resolver with an argument array and fixed flags", () => {
    expect(
      omarchyThemeResolverInvocation("/home/test/.local/state/omarchy/current/theme/colors.toml"),
    ).toEqual({
      command: "omarchy-theme-color",
      args: ["--file", "/home/test/.local/state/omarchy/current/theme/colors.toml", "--all"],
    });
  });
});

describe("Omarchy replacement recovery", () => {
  const stamp = (input: Partial<{ ino: number; mtimeMs: number; size: string }> = {}) => ({
    dev: 1,
    ino: input.ino ?? 10,
    mtimeMs: input.mtimeMs ?? 100,
    size: input.size ?? "20",
  });

  it("accepts only stable files whose name marker follows the colors generation", () => {
    expect(
      isOmarchyThemeMaterializationCoherent({
        nameBefore: stamp({ ino: 1, mtimeMs: 200 }),
        nameAfter: stamp({ ino: 1, mtimeMs: 200 }),
        colorsBefore: stamp({ ino: 2, mtimeMs: 150 }),
        colorsAfter: stamp({ ino: 2, mtimeMs: 150 }),
      }),
    ).toBe(true);
    expect(
      isOmarchyThemeMaterializationCoherent({
        nameBefore: stamp({ ino: 1, mtimeMs: 100 }),
        nameAfter: stamp({ ino: 1, mtimeMs: 100 }),
        colorsBefore: stamp({ ino: 2, mtimeMs: 150 }),
        colorsAfter: stamp({ ino: 2, mtimeMs: 150 }),
      }),
    ).toBe(false);
    expect(
      isOmarchyThemeMaterializationCoherent({
        nameBefore: stamp({ ino: 1, mtimeMs: 200 }),
        nameAfter: stamp({ ino: 1, mtimeMs: 200 }),
        colorsBefore: stamp({ ino: 2, mtimeMs: 150 }),
        colorsAfter: stamp({ ino: 3, mtimeMs: 250 }),
      }),
    ).toBe(false);
  });

  it("retracts an unavailable candidate and republishes recovery", () => {
    const initial = theme("a".repeat(64));
    const unavailable = applyOmarchyThemeCandidate(initial, null);
    expect(unavailable).toEqual({
      next: null,
      result: { status: "unavailable" },
      publish: null,
    });

    const recovered = applyOmarchyThemeCandidate(unavailable.next, theme("a".repeat(64)));
    expect(recovered.result.status).toBe("updated");
    expect(recovered.publish).toEqual(initial);

    const replacement = theme("b".repeat(64), "#8be9fd");
    const updated = applyOmarchyThemeCandidate(recovered.next, replacement);
    expect(updated.result.status).toBe("updated");
    expect(updated.next).toBe(replacement);
    expect(updated.publish).toBe(replacement);
  });

  for (const { label, platform } of [
    { label: "macOS", platform: "darwin" },
    { label: "Windows", platform: "win32" },
    { label: "generic Linux without Omarchy state", platform: "linux" },
  ] as const) {
    it.effect(`does not expose a host theme on ${label}`, () =>
      Effect.gen(function* () {
        const service = yield* OmarchyTheme;
        const subscription = yield* service.subscribe;

        expect(Option.isNone(yield* service.get)).toBe(true);
        expect(yield* service.refresh).toEqual({ status: "unavailable" });
        expect(Option.isNone(subscription.latest)).toBe(true);
        if (platform !== "linux") {
          expect(Option.isNone(yield* Stream.runHead(subscription.changes))).toBe(true);
        }
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerForPaths({
            currentDir: "/unsupported/omarchy/current",
            colorsPath: "/unsupported/omarchy/current/theme/colors.toml",
            namePath: "/unsupported/omarchy/current/theme.name",
          }).pipe(
            Layer.provide(
              Layer.merge(NodeServices.layer, Layer.succeed(HostProcessPlatform, platform)),
            ),
          ),
        ),
      ),
    );
  }
});
