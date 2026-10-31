import { isChildRunLive, isProviderNativeSubagentThread } from "@t3tools/contracts";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  OrchestratorMcpThreadStatusSnapshot,
  Project,
} from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as DateTime from "effect/DateTime";
import { isSnoozed } from "../orchestration-v2/ThreadSettlementService.ts";

const live = new Set(["queued", "preparing", "starting", "running", "waiting"]);
const text = (value: string, limit = 120) =>
  Array.from(value)
    .filter((character) => !/[\u0000-\u001f\u007f]/.test(character))
    .slice(0, limit)
    .join("");
const iso = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.formatIso(value);

export function threadStatusSnapshot(
  environmentId: EnvironmentId,
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  projects: ReadonlyArray<Pick<Project, "id" | "title" | "workspaceRoot" | "deletedAt">>,
  nowMs: number,
): OrchestratorMcpThreadStatusSnapshot {
  const projectById = new Map(
    projects
      .filter((project) => project.deletedAt === null)
      .map((project) => [project.id, project]),
  );
  const pendingInput = (thread: OrchestrationV2ThreadShell) => {
    const child =
      thread.lineage.relationshipToParent === "subagent" || thread.delegatedFrom !== undefined;
    const runtimeInput =
      thread.pendingRuntimeRequest != null &&
      (!child ||
        (thread.pendingRuntimeRequest.kind !== "auth_refresh" &&
          !isProviderNativeSubagentThread(thread) &&
          isChildRunLive(thread)));
    return (
      runtimeInput || thread.hasActionableProposedPlan || (thread.pendingGuestMessageCount ?? 0) > 0
    );
  };
  const active = (thread: OrchestrationV2ThreadShell) =>
    live.has(thread.activityRunStatus ?? thread.status) ||
    pendingInput(thread) ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? []);
  return {
    schema_version: 1,
    environment_id: environmentId,
    generated_at_ms: nowMs,
    threads: threads
      .filter(
        (thread) =>
          thread.archivedAt === null &&
          (thread.lineage.relationshipToParent !== "subagent" || pendingInput(thread)) &&
          projectById.has(thread.projectId) &&
          (thread.settledOverride !== "settled" || active(thread)),
      )
      .toSorted(
        (left, right) =>
          Number(pendingInput(right)) - Number(pendingInput(left)) ||
          Number(active(right)) - Number(active(left)) ||
          DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 64)
      .map((thread) => {
        const project = projectById.get(thread.projectId)!;
        return {
          thread_id: thread.id,
          title: text(thread.title),
          project_title: text(project.title),
          workspace_root: text(project.workspaceRoot, 4096),
          branch: thread.branch == null ? null : text(thread.branch, 256),
          worktree_path: thread.worktreePath == null ? null : text(thread.worktreePath, 4096),
          provider: text(thread.providerInstanceId, 96),
          status: thread.activityRunStatus ?? thread.status,
          settled: thread.settledOverride === "settled",
          snoozed: isSnoozed(thread, nowMs),
          pending_input: pendingInput(thread),
          background_work: backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? []),
          updated_at: DateTime.formatIso(thread.updatedAt),
          latest_run_completed_at: iso(thread.latestRunCompletedAt),
          last_visited_at: iso(thread.lastVisitedAt),
        };
      }),
  };
}
