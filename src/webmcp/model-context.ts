export type WebMcpAvailability = "available" | "unavailable";

export interface ModelContextToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
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
