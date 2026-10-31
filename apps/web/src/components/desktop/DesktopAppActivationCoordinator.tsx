import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { DesktopAppActivationRequest } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useEffect, useEffectEvent, useRef } from "react";

import { handleDesktopAppActivationRequest } from "../../desktopAppActivation";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import { newProjectId } from "../../lib/utils";
import { readProjects, readThreadShell, waitForProject } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { waitForEnvironmentShellSnapshot } from "../../state/shell";
import { desktopActivationThread } from "../../state/desktopActivation";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useAtomCommand } from "../../state/use-atom-command";

export function DesktopAppActivationCoordinator() {
  const primaryEnvironment = usePrimaryEnvironment();
  const { environments } = useEnvironments();
  const router = useRouter();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const openThread = useNewThreadHandler();
  const queueRef = useRef(Promise.resolve());
  const activation = window.desktopBridge?.appActivation;
  const loadThread = useAtomQueryRunner(desktopActivationThread, {
    reportFailure: false,
    refresh: true,
  });
  const ready =
    activation !== undefined &&
    environments.some(
      (environment) =>
        environment.connection.phase === "connected" && environment.serverConfig !== null,
    );

  const processRequest = useEffectEvent(async (request: DesktopAppActivationRequest) =>
    handleDesktopAppActivationRequest(request, {
      getTarget: async (environmentId) => {
        const target =
          environmentId === undefined
            ? primaryEnvironment
            : environments.find((environment) => environment.environmentId === environmentId);

        if (target?.connection.phase !== "connected" || target.serverConfig === null) {
          return null;
        }
        if (!(await waitForEnvironmentShellSnapshot(target.environmentId))) return null;
        return {
          environmentId: target.environmentId,
          platform: target.serverConfig.environment.platform.os,
        };
      },
      findThread: async (ref) => {
        const cached = readThreadShell(ref);
        if (cached !== null)
          return cached.archivedAt === null ? { projectId: cached.projectId } : null;
        const result = await loadThread({
          environmentId: ref.environmentId,
          input: { threadId: ref.threadId },
        });
        if (result._tag === "Failure" || result.value.thread.archivedAt !== null) return null;
        return { projectId: result.value.thread.projectId };
      },
      openExistingThread: async (ref) => {
        await router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(ref),
        });
        const expected = router.buildLocation({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(ref),
        });
        if (router.state.location.pathname !== expected.pathname)
          throw new Error("The requested thread navigation did not complete.");
      },
      findProject: (environmentId, workspaceRoot) =>
        findProjectByPath(
          readProjects().filter((project) => project.environmentId === environmentId),
          workspaceRoot,
        ) ?? null,
      createProject: async (environmentId, workspaceRoot) => {
        const projectId = newProjectId();
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            title: inferProjectTitleFromPath(workspaceRoot),
            workspaceRoot,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          throw error instanceof Error ? error : new Error("T3 Code could not add the project.");
        }
        return projectId;
      },
      waitForProject: async (projectRef) => {
        await waitForProject(projectRef);
      },
      openThread: (projectRef) => openThread(projectRef),
    }),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to desktop activation requests over the bridge and marks the renderer ready
  useEffect(() => {
    if (!ready || activation === undefined) return;

    let subscribed = true;
    const unsubscribe = activation.onRequest((request) => {
      queueRef.current = queueRef.current.then(async () => {
        const response = await processRequest(request);
        await activation.complete(response);
      });
      queueRef.current = queueRef.current.catch(() => undefined);
    });
    // Skip readiness if React runs cleanup before this subscription can receive requests.
    queueMicrotask(() => {
      if (subscribed) void activation.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void activation.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [activation, ready]);

  return null;
}
