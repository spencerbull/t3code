import { EnvironmentId, ThreadId, MessageId, type Project } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";
import { threadStatusSnapshot } from "./threadStatus.ts";

it("bounds a metadata feed, prioritizes live work, and excludes conversation and background payloads", () => {
  const threads = Array.from({ length: 70 }, (_, index) => ({
    ...liveThreadShell(ThreadId.make(`thread-${index}`)),
    status: "idle" as const,
    latestVisibleMessage: {
      id: MessageId.make("private-message"),
      role: "assistant" as const,
      text: "PRIVATE_MESSAGE",
      updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
    },
  }));
  const working = {
    ...threads[69]!,
    activityRunStatus: "running" as const,
    settledOverride: "settled" as const,
    pendingBackgroundTasks: [
      { kind: "command", taskId: "command-1", description: "PRIVATE_PAYLOAD", awaited: true },
    ] satisfies NonNullable<(typeof threads)[number]["pendingBackgroundTasks"]>,
  };
  threads[69] = working;
  const project = {
    id: threads[0]!.projectId,
    title: "Project",
    workspaceRoot: "/workspace/project",
    deletedAt: null,
  } satisfies Pick<Project, "id" | "title" | "workspaceRoot" | "deletedAt">;
  const result = threadStatusSnapshot(EnvironmentId.make("local"), threads, [project], 0);
  expect(result.threads).toHaveLength(64);
  expect(result.threads[0]).toMatchObject({
    thread_id: working.id,
    status: "running",
    background_work: true,
    settled: true,
  });
  const olderApproval = {
    ...working,
    id: ThreadId.make("old-approval"),
    updatedAt: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
    hasActionableProposedPlan: true,
  };
  expect(
    threadStatusSnapshot(
      EnvironmentId.make("local"),
      [
        ...Array.from({ length: 64 }, (_, i) => ({ ...working, id: ThreadId.make(`live-${i}`) })),
        olderApproval,
      ],
      [project],
      0,
    ).threads[0]?.thread_id,
  ).toBe(olderApproval.id);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(result.threads[0]).not.toHaveProperty("latestVisibleMessage");
  expect(
    threadStatusSnapshot(
      EnvironmentId.make("local"),
      [
        {
          ...working,
          status: "completed",
          activityRunStatus: null,
          pendingBackgroundTasks: [{ kind: "command", taskId: "dev-server" }],
        },
      ],
      [project],
      0,
    ).threads,
  ).toEqual([]);
  expect(
    threadStatusSnapshot(
      EnvironmentId.make("local"),
      [{ ...threads[0]!, archivedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z") }],
      [project],
      0,
    ).threads,
  ).toEqual([]);
  expect(
    threadStatusSnapshot(
      EnvironmentId.make("local"),
      [{ ...threads[0]!, settledOverride: "settled" }],
      [project],
      0,
    ).threads,
  ).toEqual([]);
});

it("keeps a settled thread's new plan and pending-input subagents visible without ordinary child duplicates", () => {
  const root = {
    ...liveThreadShell(ThreadId.make("root")),
    status: "completed" as const,
    settledOverride: "settled" as const,
    hasActionableProposedPlan: true,
  };
  const child = {
    ...liveThreadShell(ThreadId.make("child")),
    lineage: {
      rootThreadId: root.id,
      parentThreadId: root.id,
      relationshipToParent: "subagent" as const,
    },
  };
  const needsInput = {
    ...child,
    id: ThreadId.make("child-needs-input"),
    hasActionableProposedPlan: true,
  };
  const project = {
    id: root.projectId,
    title: "Project",
    workspaceRoot: "/workspace/project",
    deletedAt: null,
  };
  const snapshot = threadStatusSnapshot(
    EnvironmentId.make("local"),
    [root, child, needsInput],
    [project],
    0,
  );
  expect(snapshot.threads.map((thread) => thread.thread_id).toSorted()).toEqual(
    [root.id, needsInput.id].toSorted(),
  );
  expect(snapshot.threads.every((thread) => thread.pending_input)).toBe(true);
});
