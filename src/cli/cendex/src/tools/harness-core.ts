import { join } from "node:path";
import {
	readFileContent,
	writeFileContent,
	appendFileContent,
	editFileContent,
	searchRepository,
	scanRepositoryNames,
} from "./fileHandler";
import { cencori, type ChatMessage } from "../server/Models";
import type { ToolCallCheck, ActionLogEntry } from "./harness-types";
import type { ToolDecision, ActionPlan } from "./harness-schemas";
import {
	pickWord,
	extractJson,
	isValidDecision,
	isValidActionPlan,
} from "./harness-utils";
import type { ThinkingPhase } from "../hooks/useThinkingWord";
import { THINKING_WORDS } from "../constants/thinkingWords";
import {
	buildAgentSystemPrompt,
	buildActionPlanPrompt,
	buildToolDecisionPrompt,
} from "./harness-prompts";
import {
	MAX_PLAN_ATTEMPTS,
	MAX_DECISION_ATTEMPTS,
	CONFIDENCE_THRESHOLD,
} from "./harness-constants";

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------
const loadRepoContext = async (
	localDir: string,
): { repoMap: string; repoContextString: string } => {
	const mapId = Bun.env.REPO_MAP_ID as string;
	const baseId = Bun.env.BASECODE_README_ID as string;

	const [basecodeMatches, repoMapMatches] = await Promise.all([
		searchRepository(localDir, baseId, { matchType: "exact" }),
		searchRepository(localDir, mapId, { matchType: "exact" }),
	]);

	let repoMap: string;
	if (!repoMapMatches.length) {
		repoMap = JSON.stringify(await scanRepositoryNames(localDir));
		await writeFileContent(mapId, repoMap, { overwrite: true });
	} else {
		repoMap = await readFileContent(join(localDir, repoMapMatches[0]!.path));
	}

	let repoContextString: string;
	if (!basecodeMatches.length) {
		repoContextString = `### REPO FILE PATHS\n${repoMap}\n\nAsk the user to run /init to get started.`;
	} else {
		repoContextString = await readFileContent(
			join(localDir, basecodeMatches[0]!.path),
		);
	}

	return { repoMap, repoContextString };
};

async function* resolveToolDecision(
	taskDescription: string,
	modelId: string,
	repoMap: string,
	priorMessages: ChatMessage[],
): AsyncGenerator<{ delta: string }, ToolDecision | null, void> {
	let bestDecision: ToolDecision | null = null;
	let feedback = "";

	for (let attempt = 1; attempt <= MAX_DECISION_ATTEMPTS; attempt++) {
		const res = await cencori.ai.chat({
			model: modelId,
			messages: [
				{ role: "system", content: buildToolDecisionPrompt(repoMap) },
				...priorMessages.slice(-10),
				{
					role: "user",
					content: feedback
						? `${taskDescription}\n\n${feedback}`
						: taskDescription,
				},
			],
			temperature: 0.2,
			maxTokens: 400,
		});

		try {
			const candidate = JSON.parse(extractJson(res.content));
			if (!isValidDecision(candidate)) throw new Error("Invalid schema");

			if (!bestDecision || candidate.confidence > bestDecision.confidence) {
				bestDecision = candidate;
			}

			if (candidate.confidence >= CONFIDENCE_THRESHOLD) return candidate;

			if (attempt < MAX_DECISION_ATTEMPTS) {
				yield {
					delta: `${pickWord(THINKING_WORDS)} (${candidate.confidence}% sure)...\n\n`,
				};
				feedback = `Confidence only ${candidate.confidence}%. Reasoning: "${candidate.reasoning}". Try again.`;
			}
		} catch (err) {
			feedback = `Invalid JSON or schema. Respond ONLY with the requested JSON object.`;
		}
	}
	return bestDecision;
}

async function* resolveActionPlan(
	taskDescription: string,
	modelId: string,
	knownContents: string,
): AsyncGenerator<{ delta: string }, ActionPlan | null, void> {
	let feedback = "";

	for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
		const res = await cencori.ai.chat({
			model: modelId,
			messages: [
				{
					role: "system",
					content: buildActionPlanPrompt(taskDescription, knownContents),
				},
				{ role: "user", content: feedback || "Produce the action plan now." },
			],
			temperature: 0.1,
			maxTokens: 3000,
		});

		try {
			const candidate = JSON.parse(extractJson(res.content));
			if (!isValidActionPlan(candidate)) throw new Error("Invalid schema");
			return candidate;
		} catch {
			feedback = `Invalid schema or mismatched needsChanges/actions array. Try again.`;
			if (attempt < MAX_PLAN_ATTEMPTS) {
				yield { delta: `${pickWord(THINKING_WORDS)} checking plan...\n\n` };
			}
		}
	}
	return null;
}

async function* executeActionPlan(
	plan: ActionPlan,
	localDir: string,
	updateThinkingWord?: (thinking?: ThinkingPhase) => void,
): AsyncGenerator<{ delta: string }, ActionLogEntry[], void> {
	const actionsLog: ActionLogEntry[] = [];

	if (!plan.needsChanges || plan.actions.length === 0) {
		yield { delta: `* No file changes needed.\n\n` };
		return actionsLog;
	}

	updateThinkingWord?.("toolLeveraging");
	for (const action of plan.actions) {
		const targetPath = action.path.trim();
		const fullPath = join(localDir, targetPath);

		try {
			yield { delta: `- Executing ${action.type} on ${targetPath}...\n\n` };

			if (action.type === "edit") {
				await editFileContent(fullPath, action.target!, action.replacement!);
			} else if (action.type === "write") {
				await writeFileContent(fullPath, action.content!, { overwrite: true });
			} else {
				await appendFileContent(fullPath, action.content!);
			}

			yield { delta: `+ Completed ${action.type} on ${targetPath}\n\n` };
			actionsLog.push({
				path: targetPath,
				type: action.type,
				reasoning: action.reasoning,
			});
		} catch (e: any) {
			yield {
				delta: `! Failed to ${action.type} ${targetPath}: ${e.message}\n\n`,
			};
			actionsLog.push({
				path: targetPath,
				type: `${action.type}-failed` as any,
				reasoning: action.reasoning,
			});
		}
	}
	return actionsLog;
}

export async function* runLocalMemoryAgentWithRepoContext(
	taskDescription: string,
	modelId: string,
	priorMessages: ChatMessage[] = [],
	updateThinkingWord?: (thinking?: ThinkingPhase) => void,
) {
	const localDir = process.cwd();
	const { repoMap, repoContextString } = await loadRepoContext(localDir);

	updateThinkingWord?.("toolThinking");
	let decision: ToolDecision | null = null;
	for await (const chunk of resolveToolDecision(
		taskDescription,
		modelId,
		repoMap,
		priorMessages,
	)) {
		if (chunk) yield chunk;
		else decision = chunk as any; // Capture final return
	}

	let toolCallCheck: ToolCallCheck | null = null;
	let fileReadResult = "";

	if (decision?.needsTool && decision.tool) {
		toolCallCheck = {
			tool: decision.tool,
			targetFiles: decision.targetFiles,
			actionType: decision.actionType ?? "read",
		};
		yield {
			delta: `+ Reading ${toolCallCheck.targetFiles.length} file(s)...\n\n`,
		};

		for (const filePath of toolCallCheck.targetFiles) {
			try {
				const fileData = await readFileContent(join(localDir, filePath));
				fileReadResult += `--- ${filePath} ---\n${fileData}\n`;
			} catch (e: any) {
				fileReadResult += `--- ${filePath} ---\nFailed to read: ${e.message}\n`;
			}
			yield { delta: `- Read ${filePath}\n\n` };
			updateThinkingWord?.("toolLeveraging");
		}
	}

	let actionsLog: ActionLogEntry[] = [];
	if (fileReadResult) {
		updateThinkingWord?.("toolThinking");
		let plan: ActionPlan | null = null;

		for await (const chunk of resolveActionPlan(
			taskDescription,
			modelId,
			fileReadResult,
		)) {
			if (chunk) yield chunk;
			else plan = chunk as any;
		}

		if (plan) {
			for await (const chunk of executeActionPlan(
				plan,
				localDir,
				updateThinkingWord,
			)) {
				if (chunk) yield chunk;
				else actionsLog = chunk as any;
			}
		}
	}

	const taskMessageContent = `
### TASK
${taskDescription}

### REPO MAP
${repoMap} 
YOU ARE IN THE ROOT DIRECTORY ALWAYS CREATE FILES AND FOLDERS IN IT

${priorMessages.length < 5 ? `### REPOSITORY CONTEXT\n${repoContextString}` : ""}
${toolCallCheck ? `### FILE READ RESULT\n${fileReadResult}` : ""}
${actionsLog.length ? `### ACTIONS TAKEN\n${actionsLog.map((a) => `- ${a.type} ${a.path}: ${a.reasoning}`).join("\n")}` : ""}
	`.trim();

	const messages: ChatMessage[] = [
		{ role: "system", content: buildAgentSystemPrompt(localDir) },
		...priorMessages,
		{ role: "user", content: taskMessageContent },
	];

	updateThinkingWord?.("thinking");
	const finalStream = await cencori.ai.chatStream({
		model: modelId,
		messages,
		temperature: 0.2,
		maxTokens: 10000,
	});

	for await (const chunk of finalStream) {
		yield chunk;
		updateThinkingWord?.();
	}
}

