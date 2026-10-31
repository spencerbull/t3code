import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

export const desktopActivationThread = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "desktop-activation:thread",
  tag: ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
});
