import type { FileAction } from "./harness-schemas";

type ToolName = "read" | "edit" | "write" | "append" | null;

export type ToolCallCheck = {
	tool: ToolName;
	targetFiles: string[];
};

export type ActionLogEntry = {
	path: string;
	type: FileAction["type"] | "edit-failed" | "write-failed" | "append-failed";
	reasoning: string;
};
