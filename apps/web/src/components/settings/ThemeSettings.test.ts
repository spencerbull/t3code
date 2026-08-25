import { describe, expect, it } from "vite-plus/test";

import { getHostThemeChoiceViewModel } from "./ThemeSettings";

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
describe("host theme appearance choice", () => {
  it("is absent when the active environment does not expose a host theme", () => {
    expect(getHostThemeChoiceViewModel(null, false)).toBeNull();
  });

  it("uses neutral copy when the active environment exposes a host theme", () => {
    expect(getHostThemeChoiceViewModel(hostTheme, false)).toEqual({
      label: "Follow system theme",
      description: "Use Dracula from the active environment.",
      actionLabel: "Use",
      actionAriaLabel: "Use system theme from the active environment",
      actionPressed: false,
    });
  });

  it("marks the selected state pressed instead of disabling the control", () => {
    expect(getHostThemeChoiceViewModel(hostTheme, true)).toEqual({
      label: "Follow system theme",
      description: "Use Dracula from the active environment.",
      actionLabel: "Following",
      actionAriaLabel: "Following system theme from the active environment, currently active",
      actionPressed: true,
    });
  });
});
