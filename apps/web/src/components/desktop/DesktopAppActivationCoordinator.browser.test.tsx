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
  readThread: vi.fn(),
  loadThread: vi.fn(),
  waitForSnapshot: vi.fn(),
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
vi.mock(import("../../state/shell"), () => ({
  waitForEnvironmentShellSnapshot: (environmentId: string) => state.waitForSnapshot(environmentId),
}));
vi.mock(import("../../state/desktopActivation"), () => ({
  desktopActivationThread: Symbol("query") as never,
}));
vi.mock(import("../../state/use-atom-query-runner"), () => ({
  useAtomQueryRunner: (() => state.loadThread) as never,
}));
vi.mock(import("../../state/entities"), () => ({
  readProjects: () => [],
  waitForProject: async () => {
    throw new Error("exact activation must not create a project");
  },
  readThreadShell: (ref: { environmentId: string; threadId: string }) => state.readThread(ref),
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

it.each(["cached", "uncached"])(
  "waits for the target shell and opens a %s remote thread while the primary is disconnected",
  async (cache) => {
    vi.clearAllMocks();
    state.router.state.location.pathname = "/";
    state.readThread.mockReturnValue(
      cache === "cached" ? { projectId: "project", archivedAt: null } : null,
    );
    state.loadThread.mockResolvedValue({
      _tag: "Success",
      value: { thread: { projectId: "project", archivedAt: null } },
    });
    let releaseSnapshot!: (ready: boolean) => void;
    let waitingForSnapshot!: () => void;
    const snapshotRequested = new Promise<"waiting">((resolve) => {
      waitingForSnapshot = () => resolve("waiting");
    });
    state.waitForSnapshot.mockImplementation(() => {
      waitingForSnapshot();
      return new Promise<boolean>((resolve) => {
        releaseSnapshot = resolve;
      });
    });
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
    expect(await Promise.race([snapshotRequested, completed.then(() => "completed")])).toBe(
      "waiting",
    );
    expect(state.waitForSnapshot).toHaveBeenCalledWith("remote");
    expect(state.router.navigate).not.toHaveBeenCalled();
    releaseSnapshot(true);
    expect(await completed).toMatchObject({ ok: true, threadId: "thread" });
    expect(state.loadThread).toHaveBeenCalledTimes(cache === "uncached" ? 1 : 0);
    expect(state.router.navigate).toHaveBeenCalledOnce();
    expect(state.createProject).not.toHaveBeenCalled();
    expect(state.openThread).not.toHaveBeenCalled();
  },
);
