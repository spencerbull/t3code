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
  it("clears an environment A palette when routing changes to no environment", () => {
    expect(
      resolveHostThemeSyncTarget({
        environmentId: environmentA,
        hostTheme,
        cachedEnvironmentId: null,
      }),
    ).toEqual({ environmentId: environmentA, hostTheme });
    expect(
      resolveHostThemeSyncTarget({
        environmentId: null,
        hostTheme: undefined,
        cachedEnvironmentId: environmentA,
      }),
    ).toEqual({ environmentId: null, hostTheme: null });
  });

  it("preserves only the matching environment cache while config is loading or offline", () => {
    expect(
      resolveHostThemeSyncTarget({
        environmentId: environmentA,
        hostTheme: undefined,
        cachedEnvironmentId: environmentA,
      }),
    ).toBeNull();
    expect(
      resolveHostThemeSyncTarget({
        environmentId: environmentB,
        hostTheme: undefined,
        cachedEnvironmentId: environmentA,
      }),
    ).toEqual({ environmentId: environmentB, hostTheme: null });
  });
});
