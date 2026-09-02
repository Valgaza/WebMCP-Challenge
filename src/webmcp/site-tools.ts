import { z } from "zod";
import type { ProjectService } from "../application/project-service";
import type { ProjectRecord } from "../domain/project";
import type { WorkspaceService } from "../application/workspace-service";
import { ProjectError, toProjectError } from "../domain/project-error";
import { proposedOperationSchema } from "../domain/project-persistence";
import { createPhotoDocumentInputSchema } from "../domain/photo-document";
import { workspaceChangeSchema } from "../domain/workspace";
import { editorCommands, searchEditorCommands } from "../editor/editor-commands";
import { getSemanticTarget, semanticTargets } from "../editor/semantic-targets";
import { webMcpActivityStore } from "./activity-store";
import { focusStore } from "./focus-store";
import type { ModelContextApi, ModelContextToolDefinition } from "./model-context";

export const WEBMCP_SCHEMA_VERSION = "2.0.0";
export const ESTRO_TOOL_COUNT = 15;

const inspectProjectSchema = z.object({ projectId: z.string().min(1), historyLimit: z.number().int().min(1).max(20).default(8) });
const manageProjectSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), name: z.string().trim().min(1, "Enter a project name.").max(120, "Use a project name with 120 characters or fewer.") }),
  z.object({ operation: z.literal("rename"), projectId: z.string().min(1), name: z.string().trim().min(1, "Enter a project name.").max(120, "Use a project name with 120 characters or fewer.") }),
  z.object({ operation: z.literal("duplicate"), projectId: z.string().min(1) }),
  z.object({ operation: z.literal("save"), projectId: z.string().min(1) }),
  z.object({ operation: z.literal("save_as"), projectId: z.string().min(1), name: z.string().trim().min(1, "Enter a project name.").max(120, "Use a project name with 120 characters or fewer.") }),
  z.object({ operation: z.literal("snapshot"), projectId: z.string().min(1), name: z.string().trim().min(1, "Enter a snapshot name.").max(120, "Use a snapshot name with 120 characters or fewer.") }),
  z.object({ operation: z.literal("request_delete"), projectId: z.string().min(1) }),
]);
const proposalInputSchema = z.object({ projectId: z.string().min(1), operations: z.array(proposedOperationSchema).min(1).max(10) });
const proposalIdSchema = z.object({ proposalId: z.string().min(1) });
const transactionIdSchema = z.object({ transactionId: z.string().min(1) });
const undoSchema = z.object({ projectId: z.string().min(1), transactionId: z.string().min(1) });
const projectIdSchema = z.object({ projectId: z.string().min(1) });
const workspaceInputSchema = z.object({ projectId: z.string().min(1), change: workspaceChangeSchema });
const selectionInputSchema = z.object({
  projectId: z.string().min(1),
  selectionType: z.enum(["none", "canvas", "document"]),
  targetId: z.string().min(1).nullable(),
});
const focusInputSchema = z.object({ projectId: z.string().min(1), targetId: z.string().min(1) });
const searchCommandsSchema = z.object({ query: z.string().max(120).default("") });

const actor = { type: "agent" as const, id: "webmcp-agent", displayName: "WebMCP agent" };

function jsonSchema(properties: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function toolResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorEnvelope(error: unknown) {
  const parsed = toProjectError(error);
  return toolResult({
    ok: false,
    error: {
      code: parsed.code,
      message: parsed.message,
      fieldPath: parsed.fieldPath ?? null,
      expected: parsed.code === "INVALID_INPUT" ? "A value matching the declared tool input schema." : null,
      conflictingIds: [],
      capabilityRequirement: null,
      permissionRequirements: [],
      projectPreserved: true,
      recoverySuggestion: recoverySuggestion(parsed),
    },
  });
}

function recoverySuggestion(error: ProjectError): string {
  if (error.code === "PROPOSAL_STALE" || error.code === "HISTORY_CONFLICT") return "Inspect the latest project revision, then prepare a new proposal.";
  if (error.code === "PROJECT_NAME_CONFLICT") return "Choose a different local project name.";
  if (error.code.startsWith("STORAGE_")) return "Keep this page open, check browser storage, and retry the same action.";
  return "Correct the indicated input and retry. No project revision was changed.";
}

function visibleToolError(error: unknown, title = "Estro could not complete that request") {
  const parsed = toProjectError(error);
  webMcpActivityStore.show({
    id: crypto.randomUUID(),
    stage: "failed",
    title,
    detail: `${parsed.message} The current project state was preserved.`,
  });
  return errorEnvelope(parsed);
}

function resultForMutation(result: Awaited<ReturnType<ProjectService["renameProject"]>>) {
  return {
    ok: true,
    projectId: result.project.id,
    transactionId: result.transaction.id,
    undoToken: result.transaction.id,
    resultingRevisionId: result.headRevision.id,
    affectedIds: result.transaction.affectedIds,
    normalizedParameters: result.normalizedParameters ?? {},
    warnings: result.transaction.warnings,
    summary: result.transaction.summary,
    undoAvailable: result.canUndo,
  };
}

/**
 * A new project identity is committed with its own initiating transaction, but the lifecycle
 * service returns only the project record. Recover that transaction so create, duplicate, and
 * Save As report the same transaction identity, affected IDs, and warnings as every other
 * mutation instead of a reduced payload.
 */
async function resultForProjectCreation(service: ProjectService, project: ProjectRecord, summary: string) {
  const history = await service.getProjectHistory(project.id);
  const transaction = history.transactions.find((entry) => entry.resultingRevisionId === project.headRevisionId) ?? null;
  return {
    ok: true,
    projectId: project.id,
    transactionId: transaction?.id ?? null,
    undoToken: transaction?.undoable ? transaction.id : null,
    resultingRevisionId: project.headRevisionId,
    affectedIds: transaction?.affectedIds ?? [project.id],
    normalizedParameters: {},
    warnings: transaction?.warnings ?? [],
    summary,
    undoAvailable: transaction?.undoable ?? false,
  };
}

export function createEstroSiteTools(service: ProjectService, workspaceService: WorkspaceService): ModelContextToolDefinition[] {
  const execute = (stage: Parameters<typeof webMcpActivityStore.show>[0]["stage"], title: string, detail: string, task: () => Promise<Record<string, unknown>>) =>
    async () => {
      const id = crypto.randomUUID();
      webMcpActivityStore.show({ id, stage, title, detail });
      try {
        const payload = await task();
        webMcpActivityStore.show({
          id, stage: "complete", title: (payload.summary as string | undefined) ?? `${title} complete`, detail: `Result ready from schema ${WEBMCP_SCHEMA_VERSION}.`,
          projectId: payload.projectId as string | undefined,
          transactionId: payload.transactionId as string | undefined,
          undoProjectId: payload.undoAvailable ? payload.projectId as string : undefined,
        });
        return toolResult(payload);
      } catch (error) {
        const parsed = toProjectError(error);
        webMcpActivityStore.show({ id, stage: "failed", title: "Estro could not complete that request", detail: parsed.message });
        return errorEnvelope(parsed);
      }
    };

  return [
    {
      name: "get_capabilities",
      description: "Report Estro's current local project, transaction, proposal, permission, and WebMCP capabilities without changing a project.",
      inputSchema: jsonSchema(),
      annotations: { readOnlyHint: true },
      execute: execute("inspecting", "Inspecting Estro capabilities", "Reading the bounded local capability contract.", async () => ({
        ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, toolCount: ESTRO_TOOL_COUNT, storage: "browser-indexeddb", remoteCompute: false,
        operations: ["create", "rename", "duplicate", "save", "save_as", "snapshot", "request_delete", "propose", "apply", "undo", "create_image_document", "inspect_workspace", "set_workspace", "inspect_selection", "set_selection", "focus_ui", "search_commands"],
        limits: { inspectionHistory: 20, proposalOperations: 10, proposalLifetimeSeconds: 600, documentPixelsPerAxis: 32768, zoom: { minimum: 0.05, maximum: 32 }, panelWidths: { left: [224, 360], inspector: [272, 400] } },
        permissionPolicy: { destructiveDeletion: "explicit-visible-confirmation" },
        capabilities: { fullscreen: typeof document.fullscreenEnabled === "boolean" ? document.fullscreenEnabled : false, pointerEvents: "PointerEvent" in globalThis, workspaceFallback: "in-page-distraction-free" },
        semanticTargets,
        commandIds: editorCommands.map((command) => command.id),
      })),
    },
    {
      name: "inspect_project",
      description: "Inspect one local Estro project, its durable revision, recovery state, snapshots, and a bounded transaction history. This never mutates the project.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 }, historyLimit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
      }, ["projectId"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        let parsed: z.infer<typeof inspectProjectSchema>;
        try { parsed = inspectProjectSchema.parse(input); } catch (error) { return visibleToolError(error, "Project inspection needs valid input"); }
        return execute("inspecting", "Inspecting project", `Reading project ${parsed.projectId}.`, async () => {
          const [history, persistence] = await Promise.all([
            service.getProjectHistory(parsed.projectId), service.getProjectPersistence(parsed.projectId),
          ]);
          return {
            ok: true, projectId: history.project.id, revisionId: history.headRevision.id,
            project: { name: history.project.name, kind: history.project.kind, updatedAt: history.project.updatedAt },
            durability: persistence.durability, hasRecoverableDraft: persistence.hasRecoverableDraft,
            hasPendingAutosave: persistence.hasPendingAutosave,
            snapshots: persistence.snapshots.slice(0, 20),
            transactions: history.transactions.slice(-parsed.historyLimit).map((transaction) => ({
              id: transaction.id, sequence: transaction.sequence, summary: transaction.summary, actor: transaction.actor,
              sourceRevisionId: transaction.sourceRevisionId, resultingRevisionId: transaction.resultingRevisionId,
              undoable: transaction.undoable, createdAt: transaction.createdAt,
            })),
          };
        })();
      },
    },
    {
      name: "manage_project",
      description: "Create, rename, duplicate, save, Save As, snapshot, or request deletion of a local Estro project. Deletion always pauses for visible user confirmation.",
      inputSchema: jsonSchema({
        operation: { enum: ["create", "rename", "duplicate", "save", "save_as", "snapshot", "request_delete"] },
        projectId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 120 },
      }, ["operation"]),
      execute: async (input) => {
        let parsed: z.infer<typeof manageProjectSchema>;
        try { parsed = manageProjectSchema.parse(input); } catch (error) { return visibleToolError(error, "Project command needs valid input"); }
        const activityId = crypto.randomUUID();
        try {
          if (parsed.operation === "request_delete") {
            const project = await service.getProject(parsed.projectId);
            webMcpActivityStore.requestConfirmation({
              id: activityId, title: `Delete “${project.name}”?`,
              consequence: "This permanently removes the local project from this browser. Other projects are not affected.",
              projectId: project.id, projectName: project.name,
            }, () => service.deleteProject(project.id, { actor, intent: "Delete the project after explicit user confirmation." }));
            return toolResult({
              ok: false, status: "confirmation_required", confirmationId: activityId, projectId: project.id,
              consequence: "Permanent local deletion", permission: "explicit_user_confirmation", projectPreserved: true,
            });
          }

          webMcpActivityStore.show({ id: activityId, stage: "committing", title: "Applying project command", detail: `Running ${parsed.operation}.`, projectId: "projectId" in parsed ? parsed.projectId : undefined });
          let payload: Record<string, unknown>;
          if (parsed.operation === "create") {
            const project = await service.createProject({ name: parsed.name, kind: "unassigned" }, { actor });
            payload = await resultForProjectCreation(service, project, `Created “${project.name}”.`);
          } else if (parsed.operation === "rename") {
            const result = await service.renameProject({ projectId: parsed.projectId, name: parsed.name }, { actor });
            await service.waitForAutosave(result.project.id);
            payload = { ...resultForMutation(result), durability: "durable" };
          } else if (parsed.operation === "duplicate") {
            const project = await service.duplicateProject(parsed.projectId, { actor });
            payload = await resultForProjectCreation(service, project, `Created “${project.name}” as a separate project.`);
          } else if (parsed.operation === "save_as") {
            const project = await service.saveProjectAs(parsed.projectId, parsed.name, { actor });
            payload = await resultForProjectCreation(service, project, `Saved a separate project as “${project.name}”.`);
          } else if (parsed.operation === "snapshot") {
            payload = resultForMutation(await service.createSnapshot(parsed.projectId, parsed.name, { actor }));
          } else {
            // Save promotes durability rather than committing a revision, so it has no transaction.
            // State that explicitly instead of omitting the fields every other mutation returns.
            const durability = await service.saveProject(parsed.projectId);
            payload = {
              ok: true, projectId: parsed.projectId, transactionId: null, undoToken: null,
              resultingRevisionId: durability.durableRevisionId, affectedIds: [parsed.projectId],
              normalizedParameters: {}, warnings: [], summary: "Saved the current project revision.",
              undoAvailable: false, durability: "durable",
            };
          }
          webMcpActivityStore.show({ id: activityId, stage: "complete", title: payload.summary as string, detail: "The result is durable and inspectable.", projectId: payload.projectId as string, transactionId: payload.transactionId as string | undefined, undoProjectId: payload.undoAvailable ? payload.projectId as string : undefined });
          return toolResult(payload);
        } catch (error) {
          const parsedError = toProjectError(error);
          webMcpActivityStore.show({ id: activityId, stage: "failed", title: "Project command failed", detail: parsedError.message });
          return errorEnvelope(parsedError);
        }
      },
    },
    {
      name: "propose_transaction",
      description: "Validate and normalize an ordered Estro project transaction without mutating the project. The proposal expires and is bound to its source revision.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        operations: { type: "array", minItems: 1, maxItems: 10, items: { oneOf: [
          jsonSchema({ type: { const: "rename_project" }, name: { type: "string", minLength: 1, maxLength: 120 } }, ["type", "name"]),
          jsonSchema({ type: { const: "create_snapshot" }, name: { type: "string", minLength: 1, maxLength: 120 } }, ["type", "name"]),
        ] } },
      }, ["projectId", "operations"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = proposalInputSchema.parse(input);
          webMcpActivityStore.show({ id: crypto.randomUUID(), stage: "proposing", title: "Preparing a proposal", detail: `Validating ${parsed.operations.length} ordered changes.`, projectId: parsed.projectId });
          const proposal = await service.proposeTransaction(parsed, { actor });
          webMcpActivityStore.show({ id: proposal.id, stage: "proposing", title: "Proposal ready for review", detail: proposal.summary, projectId: proposal.projectId, proposalId: proposal.id });
          return toolResult({ ok: true, proposalId: proposal.id, projectId: proposal.projectId, sourceRevisionId: proposal.sourceRevisionId, operations: proposal.requestedOperations, normalizedOperations: proposal.normalizedOperations, warnings: proposal.warnings, summary: proposal.summary, expiresAt: proposal.expiresAt, projectChanged: false });
        } catch (error) { return visibleToolError(error, "Proposal could not be prepared"); }
      },
    },
    {
      name: "apply_transaction",
      description: "Atomically apply one reviewed Estro proposal if its source revision is still current. A stale or invalid proposal changes nothing.",
      inputSchema: jsonSchema({ proposalId: { type: "string", minLength: 1 } }, ["proposalId"]),
      execute: async (input) => {
        try {
          const parsed = proposalIdSchema.parse(input);
          webMcpActivityStore.show({ id: parsed.proposalId, stage: "committing", title: "Applying reviewed transaction", detail: "Checking the source revision and committing every ordered change atomically." });
          const result = await service.applyProposal(parsed.proposalId, { actor });
          await service.waitForAutosave(result.project.id);
          const payload = { ...resultForMutation(result), durability: "durable" };
          webMcpActivityStore.show({ id: parsed.proposalId, stage: "complete", title: result.transaction.summary, detail: "All ordered changes committed as one transaction.", projectId: result.project.id, transactionId: result.transaction.id, undoProjectId: result.project.id });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Transaction was not applied"); }
      },
    },
    {
      name: "inspect_transaction",
      description: "Explain one Estro transaction, including actor, intent, operations, warnings, source revision, resulting revision, and Undo identity.",
      inputSchema: jsonSchema({ transactionId: { type: "string", minLength: 1 } }, ["transactionId"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = transactionIdSchema.parse(input);
          webMcpActivityStore.show({ id: parsed.transactionId, stage: "inspecting", title: "Inspecting transaction", detail: `Reading transaction ${parsed.transactionId}.` });
          const transaction = await service.inspectTransaction(parsed.transactionId);
          const payload = { ok: true, transactionId: transaction.id, projectId: transaction.projectId, actor: transaction.actor, intent: transaction.intent, summary: transaction.summary, operations: transaction.operations, affectedIds: transaction.affectedIds, warnings: transaction.warnings, sourceRevisionId: transaction.sourceRevisionId, resultingRevisionId: transaction.resultingRevisionId, undoAvailable: transaction.undoable };
          webMcpActivityStore.show({ id: transaction.id, stage: "complete", title: "Transaction inspected", detail: transaction.summary, projectId: transaction.projectId, transactionId: transaction.id, undoProjectId: transaction.undoable ? transaction.projectId : undefined });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Transaction inspection failed"); }
      },
    },
    {
      name: "undo_transaction",
      description: "Undo the latest safe Estro transaction by immutable transaction ID, or return a structured dependency conflict without changing the project.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 }, transactionId: { type: "string", minLength: 1 } }, ["projectId", "transactionId"]),
      execute: async (input) => {
        try {
          const parsed = undoSchema.parse(input);
          webMcpActivityStore.show({ id: parsed.transactionId, stage: "committing", title: "Undoing transaction", detail: `Checking that transaction ${parsed.transactionId} is still safe to undo.`, projectId: parsed.projectId });
          const result = await service.undoTransaction(parsed.projectId, parsed.transactionId, { actor });
          await service.waitForAutosave(result.project.id);
          const payload = { ...resultForMutation(result), durability: "durable" };
          webMcpActivityStore.show({ id: result.transaction.id, stage: "complete", title: result.transaction.summary, detail: `Restored project state in revision ${result.headRevision.id}.`, projectId: result.project.id, transactionId: result.transaction.id });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Transaction could not be undone"); }
      },
    },
    {
      name: "inspect_document",
      description: "Inspect the current image document, exact dimensions, resolution, background, stable ID, and project revision without changing project or workspace state.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 } }, ["projectId"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = projectIdSchema.parse(input);
          const history = await service.getProjectHistory(parsed.projectId);
          return toolResult({
            ok: true, projectId: parsed.projectId, revisionId: history.headRevision.id,
            document: history.headRevision.state.photoDocument ?? null,
            hasDocument: Boolean(history.headRevision.state.photoDocument), projectChanged: false,
          });
        } catch (error) { return visibleToolError(error, "Document inspection failed"); }
      },
    },
    {
      name: "apply_document_operation",
      description: "Create one empty non-destructive image document in a photo or unassigned project through Estro's shared revision and Undo engine.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        expectedRevisionId: { type: "string", minLength: 1 },
        widthPx: { type: "integer", minimum: 1, maximum: 32768 },
        heightPx: { type: "integer", minimum: 1, maximum: 32768 },
        resolutionPpi: { type: "number", minimum: 1, maximum: 2400 },
        orientation: { enum: ["landscape", "portrait", "square"] },
        background: { oneOf: [
          jsonSchema({ type: { const: "transparent" } }, ["type"]),
          jsonSchema({ type: { const: "solid" }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } }, ["type", "color"]),
        ] },
      }, ["projectId", "expectedRevisionId", "widthPx", "heightPx", "resolutionPpi", "orientation", "background"]),
      execute: async (input) => {
        try {
          const parsed = createPhotoDocumentInputSchema.parse(input);
          webMcpActivityStore.show({ id: crypto.randomUUID(), stage: "committing", title: "Creating image document", detail: `Preparing ${parsed.widthPx} × ${parsed.heightPx} pixels.`, projectId: parsed.projectId });
          const result = await service.createPhotoDocument(parsed, { actor, intent: "Create an empty image document through WebMCP." });
          await service.waitForAutosave(result.project.id);
          const payload = { ...resultForMutation(result), document: result.headRevision.state.photoDocument, durability: "durable", projectChanged: true };
          webMcpActivityStore.show({ id: result.transaction.id, stage: "complete", title: result.transaction.summary, detail: `Document ${result.headRevision.state.photoDocument?.id} is ready.`, projectId: result.project.id, transactionId: result.transaction.id, undoProjectId: result.project.id });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Image document was not created"); }
      },
    },
    {
      name: "inspect_workspace",
      description: "Inspect viewport, panels, overlays, active tool, selection, and supported input/fullscreen capabilities without changing the project.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 } }, ["projectId"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = projectIdSchema.parse(input);
          const [workspace, history] = await Promise.all([workspaceService.getWorkspace(parsed.projectId), service.getProjectHistory(parsed.projectId)]);
          return toolResult({ ok: true, projectId: parsed.projectId, revisionId: history.headRevision.id, workspace, projectChanged: false });
        } catch (error) { return visibleToolError(error, "Workspace inspection failed"); }
      },
    },
    {
      name: "set_workspace",
      description: "Set a validated viewport, panel size, panel dock, tool, overlay, or distraction-free preference without creating a project revision.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        change: { oneOf: [
          jsonSchema({ type: { const: "viewport" }, viewport: { type: "object" } }, ["type", "viewport"]),
          jsonSchema({ type: { const: "panel" }, panel: { enum: ["left", "inspector"] }, open: { type: "boolean" }, widthPx: { type: "integer" } }, ["type", "panel"]),
          jsonSchema({ type: { const: "dock" }, leadingPanel: { enum: ["left", "inspector"] } }, ["type", "leadingPanel"]),
          jsonSchema({ type: { const: "tool" }, tool: { enum: ["select", "hand", "zoom"] } }, ["type", "tool"]),
          jsonSchema({ type: { const: "overlay" }, overlay: { enum: ["rulers", "guides", "grid", "snapping", "safeAreas"] }, enabled: { type: "boolean" } }, ["type", "overlay", "enabled"]),
          jsonSchema({ type: { const: "guide" }, action: { enum: ["add", "update", "remove", "clear"] }, guideId: { type: "string" }, axis: { enum: ["x", "y"] }, positionPx: { type: "number", minimum: -32768, maximum: 65536 } }, ["type", "action"]),
          jsonSchema({ type: { const: "distraction_free" }, enabled: { type: "boolean" } }, ["type", "enabled"]),
        ] },
      }, ["projectId", "change"]),
      execute: async (input) => {
        try {
          const parsed = workspaceInputSchema.parse(input);
          const before = await service.getProjectHistory(parsed.projectId);
          const workspace = await workspaceService.applyWorkspaceChange(parsed.projectId, parsed.change);
          const after = await service.getProjectHistory(parsed.projectId);
          return toolResult({ ok: true, projectId: parsed.projectId, revisionId: after.headRevision.id, workspace, projectChanged: false, revisionUnchanged: before.headRevision.id === after.headRevision.id, summary: "Updated the local editor workspace." });
        } catch (error) { return visibleToolError(error, "Workspace preference was not changed"); }
      },
    },
    {
      name: "inspect_selection",
      description: "Inspect the current stable canvas or document selection without changing it.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 } }, ["projectId"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = projectIdSchema.parse(input);
          const [workspace, history] = await Promise.all([workspaceService.getWorkspace(parsed.projectId), service.getProjectHistory(parsed.projectId)]);
          return toolResult({ ok: true, projectId: parsed.projectId, revisionId: history.headRevision.id, selection: workspace.selection, projectChanged: false });
        } catch (error) { return visibleToolError(error, "Selection inspection failed"); }
      },
    },
    {
      name: "set_selection",
      description: "Select the stable canvas or current document target without changing project content or revision history.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 }, selectionType: { enum: ["none", "canvas", "document"] }, targetId: { type: ["string", "null"] } }, ["projectId", "selectionType", "targetId"]),
      execute: async (input) => {
        try {
          const parsed = selectionInputSchema.parse(input);
          const history = await service.getProjectHistory(parsed.projectId);
          if (parsed.selectionType === "canvas" && parsed.targetId !== "canvas-stage") throw new ProjectError("INVALID_INPUT", "Canvas selection requires targetId canvas-stage.", { fieldPath: "targetId" });
          if (parsed.selectionType === "document" && parsed.targetId !== history.headRevision.state.photoDocument?.id) throw new ProjectError("INVALID_INPUT", "Document selection requires the current stable document ID.", { fieldPath: "targetId" });
          const workspace = await workspaceService.applyWorkspaceChange(parsed.projectId, { type: "selection", selectionType: parsed.selectionType, targetId: parsed.targetId });
          return toolResult({ ok: true, projectId: parsed.projectId, revisionId: history.headRevision.id, selection: workspace.selection, projectChanged: false, summary: parsed.selectionType === "none" ? "Cleared the workspace selection." : `Selected ${parsed.selectionType} ${parsed.targetId}.` });
        } catch (error) { return visibleToolError(error, "Selection was not changed"); }
      },
    },
    {
      name: "focus_ui",
      description: "Reveal and focus one stable semantic editor control. This is navigation only and never changes project or workspace data.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 }, targetId: { type: "string", enum: semanticTargets.map((target) => target.id) } }, ["projectId", "targetId"]),
      execute: async (input) => {
        try {
          const parsed = focusInputSchema.parse(input);
          const [history, workspace] = await Promise.all([service.getProjectHistory(parsed.projectId), workspaceService.getWorkspace(parsed.projectId)]);
          const target = getSemanticTarget(parsed.targetId);
          if (!target) throw new ProjectError("INVALID_INPUT", "Use a semantic target ID returned by get_capabilities or search_commands.", { fieldPath: "targetId" });
          if (parsed.targetId === "document-canvas" && !history.headRevision.state.photoDocument) throw new ProjectError("INVALID_INPUT", "Create an image document before focusing the document canvas.", { fieldPath: "targetId" });
          const request = focusStore.request(parsed.projectId, target.id, "webmcp");
          webMcpActivityStore.show({ id: request.id, stage: "targeting", title: `Focusing ${target.label}`, detail: `Revealing semantic target ${target.id}.`, projectId: parsed.projectId });
          return toolResult({ ok: true, projectId: parsed.projectId, revisionId: history.headRevision.id, target, focusRequestId: request.id, selection: workspace.selection, projectChanged: false, summary: `Requested focus for ${target.label}.` });
        } catch (error) { return visibleToolError(error, "Editor target could not be focused"); }
      },
    },
    {
      name: "search_commands",
      description: "Search the current Phase 2 command and feature index by name, category, shortcut, or keyword without changing state.",
      inputSchema: jsonSchema({ query: { type: "string", maxLength: 120, default: "" } }),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = searchCommandsSchema.parse(input);
          const results = searchEditorCommands(parsed.query);
          return toolResult({ ok: true, query: parsed.query, totalCommands: editorCommands.length, resultCount: results.length, results, projectChanged: false });
        } catch (error) { return visibleToolError(error, "Command search needs valid input"); }
      },
    },
  ];
}

const registeredContexts = new WeakSet<object>();

export function registerEstroSiteTools(service: ProjectService, workspaceService: WorkspaceService, modelContext: ModelContextApi | undefined = document.modelContext): number {
  if (!modelContext?.registerTool || registeredContexts.has(modelContext)) return 0;
  const tools = createEstroSiteTools(service, workspaceService);
  tools.forEach((tool) => modelContext.registerTool?.(tool));
  registeredContexts.add(modelContext);
  return tools.length;
}
