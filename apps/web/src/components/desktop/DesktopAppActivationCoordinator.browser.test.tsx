import type { DesktopAppActivationRequest, DesktopAppActivationResponse } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render, stubGlobal } from "../../../test/render";

const state = vi.hoisted(() => ({
  router: {
    state: { location: { pathname: "/" } },
    navigate: vi.fn(async () => {
      state.router.state.location.pathname = "/remote/thread";
    }),
    buildLocation: () => ({ pathname: "/remote/thread" }),
  },
  createProject: vi.fn(),
  openThread: vi.fn(),
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useRouter: (() => state.router) as never,
}));
vi.mock(import("../../state/environments"), () => ({
  usePrimaryEnvironment: (() => ({
    environmentId: "local",
    connection: { phase: "disconnected" },
    serverConfig: null,
  })) as never,
  useEnvironments: (() => ({
    environments: [
      {
        environmentId: "remote",
        connection: { phase: "connected" },
        serverConfig: { environment: { platform: { os: "linux" } } },
      },
    ],
  })) as never,
}));
vi.mock(import("../../state/shell"), () => ({ useEnvironmentShellHasSnapshot: () => false }));
vi.mock(import("../../state/entities"), () => ({
  readProjects: () => [],
  waitForProject: async () => {
    throw new Error("exact activation must not create a project");
  },
  readThreadShell: (ref: { environmentId: string; threadId: string }) =>
    ref.environmentId === "remote" && ref.threadId === "thread"
      ? ({ projectId: "project", archivedAt: null } as never)
      : null,
}));
vi.mock(import("../../state/projects"), () => ({
  projectEnvironment: { create: Symbol("create") } as never,
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.createProject) as never,
}));
vi.mock(import("../../hooks/useHandleNewThread"), () => ({
  useNewThreadHandler: (() => state.openThread) as never,
}));

import { DesktopAppActivationCoordinator } from "./DesktopAppActivationCoordinator";

it("opens an explicit connected environment while the primary environment is disconnected", async () => {
  vi.clearAllMocks();
  state.router.state.location.pathname = "/";
  let deliver: ((request: DesktopAppActivationRequest) => void) | undefined;
  let resolveCompleted!: (response: DesktopAppActivationResponse) => void;
  const completed = new Promise<DesktopAppActivationResponse>((resolve) => {
    resolveCompleted = resolve;
  });
  using _bridge = stubGlobal("desktopBridge", {
    appActivation: {
      onRequest: (listener: typeof deliver) => {
        deliver = listener;
        return () => undefined;
      },
      setReady: async (ready: boolean) => {
        if (ready)
          deliver?.({
            version: 1,
            requestId: "remote-open",
            type: "open-thread",
            environmentId: "remote",
            threadId: "thread",
            platform: "linux",
          } as DesktopAppActivationRequest);
      },
      complete: async (response: DesktopAppActivationResponse) => {
        resolveCompleted(response);
      },
    },
  });
  // The router is stubbed so this exercises broker readiness and exact navigation without unrelated route loaders.
  await using _screen = await render(<DesktopAppActivationCoordinator />, { router: false });
  expect(await completed).toMatchObject({ ok: true, threadId: "thread" });
  expect(state.router.navigate).toHaveBeenCalledOnce();
  expect(state.createProject).not.toHaveBeenCalled();
  expect(state.openThread).not.toHaveBeenCalled();
});
