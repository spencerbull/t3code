import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import { PrimaryConnectionTarget } from "@t3tools/client-runtime/connection";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { createDesktopActivationTargetAtom } from "./desktopActivation";

it("waits for fresh connection, config, and shell state and rejects absent or disabled targets", () => {
  const environmentId = EnvironmentId.make("target");
  const presentation = Atom.make<EnvironmentPresentation | null>(null);
  const shell = Atom.make<EnvironmentShellStatus>("empty");
  const atom = createDesktopActivationTargetAtom({
    presentationAtom: () => presentation,
    shellStatusAtom: () => shell,
  })(environmentId);
  const registry = AtomRegistry.make();
  const stop = registry.mount(atom);
  const config = { environment: { platform: { os: "linux" } } } as ServerConfig;
  const target: EnvironmentPresentation = {
    entry: {
      target: new PrimaryConnectionTarget({
        environmentId,
        label: "Target",
        httpBaseUrl: "http://localhost:9999",
        wsBaseUrl: "ws://localhost:9999",
      }),
      profile: Option.none(),
      enabled: true,
    },
    connection: { phase: "connecting", error: null, traceId: null },
    serverConfig: null,
  };
  try {
    expect(registry.get(atom)._tag).toBe("Unavailable");
    registry.set(presentation, target);
    expect(registry.get(atom)._tag).toBe("Waiting");
    registry.set(presentation, {
      ...target,
      connection: { phase: "connected", error: null, traceId: null },
    });
    expect(registry.get(atom)._tag).toBe("Waiting");
    registry.set(presentation, { ...registry.get(presentation)!, serverConfig: config });
    expect(registry.get(atom)._tag).toBe("Waiting");
    registry.set(shell, "live");
    expect(registry.get(atom)).toEqual({
      _tag: "Ready",
      target: { environmentId, platform: "linux" },
    });
    registry.set(presentation, {
      ...target,
      connection: { phase: "reconnecting", error: null, traceId: null },
      serverConfig: config,
    });
    expect(registry.get(atom)._tag).toBe("Waiting");
    registry.set(presentation, { ...target, entry: { ...target.entry, enabled: false } });
    expect(registry.get(atom)._tag).toBe("Unavailable");
    registry.set(presentation, null);
    expect(registry.get(atom)._tag).toBe("Unavailable");
  } finally {
    stop();
    registry.dispose();
  }
});
