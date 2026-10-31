import type {
  DesktopAppActivationFailure,
  DesktopAppActivationRequest,
  DesktopAppActivationResponse,
  EnvironmentId,
  ExecutionEnvironmentPlatformOs,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

export interface DesktopAppActivationProject {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
}

export interface DesktopAppActivationTarget {
  readonly environmentId: EnvironmentId;
  readonly platform: ExecutionEnvironmentPlatformOs;
}

export interface DesktopAppActivationDependencies {
  readonly getTarget: (
    environmentId?: EnvironmentId,
  ) => DesktopAppActivationTarget | null | Promise<DesktopAppActivationTarget | null>;
  readonly findThread: (
    ref: ScopedThreadRef,
  ) => { readonly projectId: ProjectId } | null | Promise<{ readonly projectId: ProjectId } | null>;
  readonly openExistingThread: (ref: ScopedThreadRef) => Promise<void>;
  readonly findProject: (
    environmentId: EnvironmentId,
    workspaceRoot: string,
  ) => DesktopAppActivationProject | null;
  readonly createProject: (
    environmentId: EnvironmentId,
    workspaceRoot: string,
  ) => Promise<ProjectId>;
  readonly waitForProject: (projectRef: ScopedProjectRef) => Promise<void>;
  readonly openThread: (
    projectRef: ScopedProjectRef,
  ) => Promise<{ readonly threadId: ThreadId } | null>;
}

function failure(
  requestId: string,
  code: DesktopAppActivationFailure["code"],
  message: string,
): DesktopAppActivationFailure {
  return { version: 1, requestId, ok: false, code, message };
}

function desktopPlatformToEnvironmentOs(
  platform: DesktopAppActivationRequest["platform"],
): ExecutionEnvironmentPlatformOs {
  return platform === "win32" ? "windows" : platform;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export async function handleDesktopAppActivationRequest(
  request: DesktopAppActivationRequest,
  dependencies: DesktopAppActivationDependencies,
): Promise<DesktopAppActivationResponse> {
  const target = await dependencies.getTarget(
    request.type === "open-thread" ? request.environmentId : undefined,
  );
  if (target === null) {
    return failure(
      request.requestId,
      "environment-unavailable",
      "The desktop app's primary local environment is not connected.",
    );
  }

  if (request.type === "open-thread") {
    if (request.environmentId !== undefined && target.environmentId !== request.environmentId) {
      return failure(
        request.requestId,
        "environment-unavailable",
        "The requested environment is not connected.",
      );
    }
    const ref = { environmentId: target.environmentId, threadId: request.threadId };
    try {
      const thread = await dependencies.findThread(ref);
      if (thread === null)
        return failure(
          request.requestId,
          "thread-open-failed",
          "The requested thread is not available in this environment.",
        );
      await dependencies.openExistingThread(ref);
      return {
        version: 1,
        requestId: request.requestId,
        ok: true,
        projectId: thread.projectId,
        threadId: request.threadId,
      };
    } catch (error) {
      return failure(
        request.requestId,
        "thread-open-failed",
        errorMessage(error, "T3 Code could not open the thread."),
      );
    }
  }

  const requestPlatform = desktopPlatformToEnvironmentOs(request.platform);
  if (requestPlatform !== target.platform) {
    return failure(
      request.requestId,
      "platform-mismatch",
      `The command path is for ${requestPlatform}, but the desktop app's primary environment uses ${target.platform}. Cross-platform path mapping is not supported.`,
    );
  }

  let projectId = dependencies.findProject(target.environmentId, request.workspaceRoot)?.id ?? null;
  if (projectId === null) {
    try {
      projectId = await dependencies.createProject(target.environmentId, request.workspaceRoot);
      await dependencies.waitForProject({ environmentId: target.environmentId, projectId });
    } catch (error) {
      return failure(
        request.requestId,
        "project-create-failed",
        errorMessage(error, "T3 Code could not add the project."),
      );
    }
  }

  try {
    const opened = await dependencies.openThread({
      environmentId: target.environmentId,
      projectId,
    });
    if (opened === null) {
      return failure(
        request.requestId,
        "thread-open-failed",
        "T3 Code could not open a new thread for the project.",
      );
    }
    return {
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId,
      threadId: opened.threadId,
    };
  } catch (error) {
    return failure(
      request.requestId,
      "thread-open-failed",
      errorMessage(error, "T3 Code could not open a new thread for the project."),
    );
  }
}
