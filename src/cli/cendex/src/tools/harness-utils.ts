import { writeFileContent, scanRepositoryNames } from "./fileHandler";

import {
	fileActionSchema,
	toolDecisionSchema,
	actionPlanSchema,
} from "./harness-schemas";
import type { FileAction, ActionPlan } from "./harness-schemas";

export const extractJson = (raw: string): string =>
	raw
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();

export const pickWord = (words: string[]): string =>
	words[Math.floor(Math.random() * words.length)]!;

export const isValidDecision = (value: unknown): value is boolean => {
	const result = toolDecisionSchema.safeParse(value);

	if (result.success) {
		return true;
	} else {
		throw result.error.format();
		return false;
	}
};

export const isValidFileAction = (value: unknown): value is FileAction => {
	const result = fileActionSchema.safeParse(value);
	if (result.success) {
		return result.data;
	} else {
		throw result.error.format();
	}
};

export const isValidActionPlan = (value: unknown): value is ActionPlan => {
	const result = actionPlanSchema.safeParse(value);
	if (result.success) {
		return result.data;
	} else {
		throw result.error.format();
	}
};

export const updatePathData = async () => {
	const localDir = process.cwd();
	const repoMap = await scanRepositoryNames(localDir);
	await writeFileContent(
		Bun.env.REPO_MAP_ID as string,
		JSON.stringify(repoMap),
		{ overwrite: true },
	);
};
