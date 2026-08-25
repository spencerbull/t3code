import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getHostThemeChoiceViewModel, resolveActiveEnvironmentHostTheme } from "./ThemeSettings";

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
const environmentId = EnvironmentId.make("environment-a");

describe("host theme appearance choice", () => {
  it("is absent when the active environment does not expose a host theme", () => {
    expect(resolveActiveEnvironmentHostTheme(null, true, new Map())).toBeNull();
    expect(resolveActiveEnvironmentHostTheme(environmentId, true, new Map())).toBeNull();
    expect(
      resolveActiveEnvironmentHostTheme(
        environmentId,
        false,
        new Map([[environmentId, { hostTheme }]]),
      ),
    ).toBeNull();
    expect(getHostThemeChoiceViewModel(null, false)).toBeNull();
  });

  it("uses neutral copy when the active environment exposes a host theme", () => {
    const activeHostTheme = resolveActiveEnvironmentHostTheme(
      environmentId,
      true,
      new Map([[environmentId, { hostTheme }]]),
    );
    expect(getHostThemeChoiceViewModel(activeHostTheme, false)).toEqual({
      label: "Follow system theme",
      description: "Use Dracula from the active environment.",
      actionLabel: "Use",
      actionDisabled: false,
    });
  });
});
