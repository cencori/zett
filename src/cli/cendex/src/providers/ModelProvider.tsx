import {
	createContext,
	useContext,
	useState,
	useCallback,
	useEffect,
	useRef,
} from "react";
import {
	fetchSupportedModels,
	queryModelStream,
	type Model,
} from "../server/Models";
import type { MessageType } from "../components/Message";
import type { ChatMessage } from "cencori";
import { readFromFile } from "../tools/fileHandler";

import { runLocalMemoryAgentWithRepoContext } from "../tools/harness-core";
import { updatePathData } from "../tools/harness-utils";

import { useToast } from "./ToastProvider";
import { useThinkingWord } from "../hooks/useThinkingWord";
import type { ThinkingPhase } from "../hooks/useThinkingWord";

export type ModelContextValue = {
	models: Model[];
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
	activeModel: Model | null;
	setActiveModel: (model: Model) => void;
	sessionMessages: MessageType[];
	setSessionMessages: (sessionMessages: MessageType[]) => void;
	respLoading: boolean;
	setRespLoading: (state: boolean) => void;
	interruptedStatusRef: React.RefObject<boolean>;
	thinkingWord: string;
};

const ModelContext = createContext<ModelContextValue | null>(null);
export const useModels = () => useContext(ModelContext);

const MODELS_RETRY_DELAY_MS = 5000;

export const ModelProvider = ({ children }: { children: React.ReactNode }) => {
	const [models, setModels] = useState<Model[]>([]);
	const [activeModel, setActiveModel] = useState<Model | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sessionMessages, setSessionMessages] = useState<MessageType[]>([]);
	const [isPlanMode, setIsPlanMode] = useState<boolean>(true);

	const toast = useToast();
	const [respLoading, setRespLoading] = useState<boolean>(false);

	// Replaces the hacky agentResponded timeout setup to lock active requests safely
	const isGeneratingRef = useRef<boolean>(false);
	const interruptedStatusRef = useRef<boolean>(false);

	const [word, advance, switchPhase] = useThinkingWord();

	const updateThinkingWord = useCallback(
		(nextPhase?: ThinkingPhase, fixedWord?: string) => {
			if (nextPhase) {
				switchPhase(nextPhase, fixedWord);
			} else {
				advance(fixedWord);
			}
		},
		[switchPhase, advance],
	);
	const mapMessagesToSession = useCallback(
		(messages: MessageType[]): ChatMessage[] => {
			return messages
				.filter((msg) => msg.type !== "error" && Boolean(msg.msg))
				.map((message) => ({
					role: message.type === "bot" ? "assistant" : "user",
					content: message.msg as string,
				}));
		},
		[],
	);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await fetchSupportedModels();
			setModels(data);
			// Set initial active model only if one isn't currently set
			setActiveModel((prev) => prev || data[0] || null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch models");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (loading || models.length > 0) return;
		const timeoutId = setTimeout(() => {
			refresh();
		}, MODELS_RETRY_DELAY_MS);
		return () => clearTimeout(timeoutId);
	}, [loading, models, refresh]);

	const getModelResp = useCallback(async () => {
		// Strictly prevent execution if a request is already running
		if (isGeneratingRef.current) return;

		const lastMessage = sessionMessages[sessionMessages.length - 1];
		if (lastMessage?.type !== "user" || typeof lastMessage.msg !== "string")
			return;

		// Lock execution immediately
		isGeneratingRef.current = true;
		setRespLoading(true);

		// Use a unique ID instead of array length to prevent collisions during rapid state updates
		const botMessageId = Date.now();

		setSessionMessages((prev) => [
			...prev,
			{ model: activeModel?.name, type: "bot", msg: "", id: botMessageId },
		]);

		try {
			updatePathData();
			const userPrompt = lastMessage.msg.trim();
			interruptedStatusRef.current = false;

			if (isPlanMode) {
				const taskDescription = userPrompt.replace(/^\/agent\s*/i, "");
				const stream = await runLocalMemoryAgentWithRepoContext(
					taskDescription,
					activeModel?.id as string,
					mapMessagesToSession(sessionMessages),
					updateThinkingWord,
				);

				let accumulated = "";
				for await (const chunk of stream) {
					if (interruptedStatusRef.current) break;
					accumulated += chunk?.delta ?? "";

					setSessionMessages((prev) =>
						prev.map((m) =>
							m.id === botMessageId ? { ...m, msg: accumulated } : m,
						),
					);
				}

				if (accumulated === "" && !interruptedStatusRef.current) {
					setSessionMessages((prev) =>
						prev.map((m) =>
							m.id === botMessageId
								? {
										...m,
										type: "error",
										msg: `Model unavailable please use an open source model ${activeModel?.id}`,
									}
								: m,
						),
					);
				}
			} else {
				const chats = mapMessagesToSession(sessionMessages.slice(0, -1));
				const stream = await queryModelStream({
					model_id: activeModel?.id as string,
					temp: 0.2,
					maxTokens: 10_000,
					session_messages: chats,
				});

				let accumulated = "";
				for await (const chunk of stream) {
					if (interruptedStatusRef.current) break;
					accumulated += chunk?.delta ?? "";
					setSessionMessages((prev) =>
						prev.map((m) =>
							m.id === botMessageId ? { ...m, msg: accumulated } : m,
						),
					);
				}

				if (accumulated === "") {
					setSessionMessages((prev) =>
						prev.map((m) =>
							m.id === botMessageId
								? {
										...m,
										type: "error",
										msg: `Request To Model ${activeModel?.name} Timed out, Please Try Again Later!`,
									}
								: m,
						),
					);
				}
			}
		} catch (err: any) {
			setSessionMessages((prev) =>
				prev.map((m) =>
					m.id === botMessageId ? { ...m, type: "error", msg: err.message } : m,
				),
			);
		} finally {
			// Ensure execution lock is released regardless of errors or interruptions
			isGeneratingRef.current = false;
			setRespLoading(false);
		}
	}, [
		sessionMessages,
		activeModel,
		mapMessagesToSession,
		isPlanMode,
		updateThinkingWord,
	]);

	// Effect 1: Handle fetching saved agent on mount
	useEffect(() => {
		const fetchCurrentSavedActiveAgent = async () => {
			if (!Bun.env?.ACTIVE_MODEL) return;
			try {
				const agent = await readFromFile(Bun.env.ACTIVE_MODEL as string);
				setActiveModel(JSON.parse(agent));
			} catch (e) {
				toast?.show("Please select a model", "notification");
			}
		};
		fetchCurrentSavedActiveAgent();
		refresh();
	}, [refresh, toast]);

	// Effect 2: Isolate `advance` timer logic with proper cleanup
	// This ensures timers aren't re-spawned thousands of times while streaming
	useEffect(() => {
		const timer = setInterval(() => {
			advance();
		}, 3000);
		return () => clearInterval(timer);
	}, [advance]);

	// Effect 3: Automatically trigger AI response when the last message is from the user
	useEffect(() => {
		const lastMessage = sessionMessages[sessionMessages.length - 1];

		// If last message is user and we aren't currently generating, fire it.
		if (
			activeModel &&
			lastMessage?.type === "user" &&
			!isGeneratingRef.current
		) {
			getModelResp();
		}

		updatePathData();
	}, [sessionMessages, activeModel, getModelResp]);

	return (
		<ModelContext.Provider
			value={{
				models,
				loading,
				error,
				refresh,
				activeModel,
				setActiveModel,
				sessionMessages,
				setSessionMessages,
				respLoading,
				setRespLoading,
				interruptedStatusRef,
				thinkingWord: word,
			}}
		>
			{children}
		</ModelContext.Provider>
	);
};

export default ModelProvider;
