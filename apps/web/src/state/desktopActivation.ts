import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { environmentShell } from "./shell";
import { waitForAtomValue } from "./waitForAtomValue";

export const desktopActivationThread = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "desktop-activation:thread",
  tag: ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
});

export function createDesktopActivationTargetAtom(input: {
  readonly presentationAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<EnvironmentPresentation | null>;
  readonly shellStatusAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellStatus>;
}) {
  return Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      const presentation = get(input.presentationAtom(environmentId));
      if (presentation === null || !presentation.entry.enabled)
        return { _tag: "Unavailable" } as const;
      if (
        presentation.connection.phase !== "connected" ||
        presentation.serverConfig === null ||
        get(input.shellStatusAtom(environmentId)) !== "live"
      )
        return { _tag: "Waiting" } as const;
      return {
        _tag: "Ready",
        target: { environmentId, platform: presentation.serverConfig.environment.platform.os },
      } as const;
    }),
  );
}

const activationTargetAtom = createDesktopActivationTargetAtom({
  presentationAtom: environmentPresentations.presentationAtom,
  shellStatusAtom: environmentShell.statusAtom,
});

export async function waitForDesktopActivationTarget(environmentId: EnvironmentId) {
  const atom = activationTargetAtom(environmentId);
  await waitForAtomValue({
    registry: appAtomRegistry,
    atom,
    predicate: (state) => state._tag !== "Waiting",
    timeoutMs: 10_000,
  });
  const state = appAtomRegistry.get(atom);
  return state._tag === "Ready" ? state.target : null;
}
