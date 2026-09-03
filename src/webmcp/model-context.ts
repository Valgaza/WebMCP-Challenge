export type WebMcpAvailability = "available" | "unavailable";

/**
 * The hints a host uses to decide what a tool needs before it runs — whether to confirm it,
 * whether it is safe to retry, whether its result can be trusted as instructions.
 *
 * Declaring only `readOnlyHint` meant every mutating tool was indistinguishable from every
 * inspection to a host reading annotations, which is the opposite of what a destructive edit
 * needs. `readOnlyHint` and `untrustedContentHint` are the two the WebMCP incubation spec
 * names; the rest are the Model Context Protocol's own and are ignored by hosts that do not
 * read them, so declaring them costs nothing and tells the ones that do.
 */
export interface ModelContextToolAnnotations {
  /** True when the tool cannot change any state. */
  readOnlyHint?: boolean;
  /** True when the tool can remove or overwrite something a repeat call cannot restore. */
  destructiveHint?: boolean;
  /** True when calling twice with the same input has the same effect as calling once. */
  idempotentHint?: boolean;
  /** True when the tool reaches beyond this page's own state. Everything here is local. */
  openWorldHint?: boolean;
  /**
   * True when the result can contain text this page did not author — a project name, a
   * comment, a file name — which a model must read as data rather than as instructions.
   */
  untrustedContentHint?: boolean;
}

export interface ModelContextToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ModelContextToolAnnotations;
  execute: (input: unknown) => Promise<unknown>;
}

export interface ModelContextApi {
  registerTool?: (definition: ModelContextToolDefinition) => void;
}

declare global {
  interface Document {
    modelContext?: ModelContextApi;
  }
}

export function getWebMcpAvailability(): WebMcpAvailability {
  return typeof document.modelContext?.registerTool === "function" ? "available" : "unavailable";
}
