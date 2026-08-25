import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveHostThemeSyncTarget } from "./hostThemeSync";

const environmentA = EnvironmentId.make("environment-a");
const environmentB = EnvironmentId.make("environment-b");
const hostTheme = {
  source: "omarchy",
  name: "Dracula",
  appearance: "dark",
  revision: "a".repeat(64),
  colors: {
    background: "#282a36",
    foreground: "#f8f8f2",
    accent: "#bd93f9",
    selection: "#44475a",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#6272a4",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
  },
} as const;

describe("host theme environment sync", () => {
  it("clears an environment A palette when routing settles on no environment", () => {
    expect(
      resolveHostThemeSyncTarget({
        environmentId: environmentA,
        hostTheme,
        cachedEnvironmentId: null,
        environmentSelectionSettled: true,
      }),
    ).toEqual({ environmentId: environmentA, hostTheme });
    expect(
      resolveHostThemeSyncTarget({
        environmentId: null,
        hostTheme: undefined,
        cachedEnvironmentId: environmentA,
        environmentSelectionSettled: true,
      }),
    ).toEqual({ environmentId: null, hostTheme: null });
  });

  it("keeps the boot cache while the environment selection is still unresolved", () => {
    // Boot: no environment is selected yet, but the dedicated cache carries
    // the last selected palette. A clear here would flash the default theme
    // and delete the cache — the sync must stay a no-op.
    expect(
      resolveHostThemeSyncTarget({
        environmentId: null,
        hostTheme: undefined,
        cachedEnvironmentId: environmentA,
        environmentSelectionSettled: false,
      }),
    ).toBeNull();
    // Same boot state with nothing cached still has nothing to do.
    expect(
      resolveHostThemeSyncTarget({
        environmentId: null,
        hostTheme: undefined,
        cachedEnvironmentId: null,
        environmentSelectionSettled: false,
      }),
    ).toBeNull();
  });

  it("preserves only the matching environment cache while config is loading or offline", () => {
    expect(
      resolveHostThemeSyncTarget({
        environmentId: environmentA,
        hostTheme: undefined,
        cachedEnvironmentId: environmentA,
        environmentSelectionSettled: true,
      }),
    ).toBeNull();
    expect(
      resolveHostThemeSyncTarget({
        environmentId: environmentB,
        hostTheme: undefined,
        cachedEnvironmentId: environmentA,
        environmentSelectionSettled: true,
      }),
    ).toEqual({ environmentId: environmentB, hostTheme: null });
  });
});
