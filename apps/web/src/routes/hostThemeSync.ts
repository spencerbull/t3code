import type { EnvironmentId, HostTheme } from "@t3tools/contracts";

export type HostThemeSyncTarget = Readonly<{
  environmentId: EnvironmentId | null;
  hostTheme: HostTheme | null;
}>;

export function resolveHostThemeSyncTarget(input: {
  readonly environmentId: EnvironmentId | null;
  readonly hostTheme: HostTheme | null | undefined;
  readonly cachedEnvironmentId: EnvironmentId | null;
}): HostThemeSyncTarget | null {
  if (input.environmentId === null) {
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
