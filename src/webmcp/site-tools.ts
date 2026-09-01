import { z } from "zod";
import type { ProjectService } from "../application/project-service";
import { ProjectError, toProjectError } from "../domain/project-error";
import { proposedOperationSchema } from "../domain/project-persistence";
import { webMcpActivityStore } from "./activity-store";
import type { ModelContextApi, ModelContextToolDefinition } from "./model-context";

export const WEBMCP_SCHEMA_VERSION = "1.0.0";

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

export function createEstroSiteTools(service: ProjectService): ModelContextToolDefinition[] {
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
        ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, toolCount: 7, storage: "browser-indexeddb", remoteCompute: false,
        operations: ["create", "rename", "duplicate", "save", "save_as", "snapshot", "request_delete", "propose", "apply", "undo"],
        limits: { inspectionHistory: 20, proposalOperations: 10, proposalLifetimeSeconds: 600 },
        permissionPolicy: { destructiveDeletion: "explicit-visible-confirmation" },
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
            payload = { ok: true, projectId: project.id, resultingRevisionId: project.headRevisionId, summary: `Created “${project.name}”.` };
          } else if (parsed.operation === "rename") {
            const result = await service.renameProject({ projectId: parsed.projectId, name: parsed.name }, { actor });
            await service.waitForAutosave(result.project.id);
            payload = { ...resultForMutation(result), durability: "durable" };
          } else if (parsed.operation === "duplicate") {
            const project = await service.duplicateProject(parsed.projectId, { actor });
            payload = { ok: true, projectId: project.id, resultingRevisionId: project.headRevisionId, summary: `Created “${project.name}” as a separate project.` };
          } else if (parsed.operation === "save_as") {
            const project = await service.saveProjectAs(parsed.projectId, parsed.name, { actor });
            payload = { ok: true, projectId: project.id, resultingRevisionId: project.headRevisionId, summary: `Saved a separate project as “${project.name}”.` };
          } else if (parsed.operation === "snapshot") {
            payload = resultForMutation(await service.createSnapshot(parsed.projectId, parsed.name, { actor }));
          } else {
            const durability = await service.saveProject(parsed.projectId);
            payload = { ok: true, projectId: parsed.projectId, resultingRevisionId: durability.durableRevisionId, summary: "Saved the current project revision." };
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
  ];
}

const registeredContexts = new WeakSet<object>();

export function registerEstroSiteTools(service: ProjectService, modelContext: ModelContextApi | undefined = document.modelContext): number {
  if (!modelContext?.registerTool || registeredContexts.has(modelContext)) return 0;
  const tools = createEstroSiteTools(service);
  tools.forEach((tool) => modelContext.registerTool?.(tool));
  registeredContexts.add(modelContext);
  return tools.length;
}
