import { z } from "zod";

export const toolDecisionSchema = z.object({
	needsTool: z.boolean(),
	confidence: z.number().finite(),
	tool: z.enum(["read", "edit", "write", "append"]).nullable(),
	targetFiles: z.array(z.string()),
	reasoning: z.string(),
});

export type ToolDecision = z.infer<typeof toolDecisionSchema>;

export const fileActionSchema = z
	.object({
		type: z.enum(["read", "write", "append", "edit"]).nullable(),
		path: z.string().min(1, "Path cannot be empty"),
		target: z.string().optional().nullable(),
		replacement: z.string().optional().nullable(),
		content: z.string().optional().nullable(),
		reasoning: z.string(),
	})
	.refine(
		(data) => {
			// Recreating your conditional logic from the manual guard:
			if (data.type === "edit") {
				return (
					typeof data.target === "string" &&
					typeof data.replacement === "string"
				);
			}
			return typeof data.content === "string";
		},
		{
			message:
				"Edit actions require target and replacement; write/append actions require content.",
		},
	);

export type FileAction = z.infer<typeof fileActionSchema>;

export const actionPlanSchema = z.object({
	needsChanges: z.boolean(),
	actions: z.array(fileActionSchema),
	reasoning: z.string(),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;
