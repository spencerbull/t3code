import type { EnvironmentId, HostTheme } from "@t3tools/contracts";

export type HostThemeSyncTarget = Readonly<{
  environmentId: EnvironmentId | null;
  hostTheme: HostTheme | null;
}>;

export function resolveHostThemeSyncTarget(input: {
  readonly environmentId: EnvironmentId | null;
  readonly hostTheme: HostTheme | null | undefined;
  readonly cachedEnvironmentId: EnvironmentId | null;
  /**
   * Whether the routed/active environment choice has actually been made. Boot
   * starts with no environment selected while auth and the config stream are
   * still resolving; clearing then would wipe the dedicated boot cache that
   * keeps startup and offline periods on the last selected palette.
   */
  readonly environmentSelectionSettled: boolean;
}): HostThemeSyncTarget | null {
  if (input.environmentId === null) {
    if (!input.environmentSelectionSettled) return null;
    return { environmentId: null, hostTheme: null };
  }
  if (input.hostTheme === undefined && input.cachedEnvironmentId === input.environmentId) {
    return null;
  }
  return {
    environmentId: input.environmentId,
    hostTheme: input.hostTheme ?? null,
  };
}
