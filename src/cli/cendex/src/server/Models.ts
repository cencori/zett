/**
 * models.ts
 *
 * Core module for interacting with Cencori's model API.
 * Handles the Cencori client, listing supported models, and streaming chat queries.
 */

import { Cencori } from "cencori";

// Load and validate the Cencori API key from environment variables.
const apiKey = Bun.env.CENCORI_API_KEY || null;
if (!apiKey) {
	throw new Error(
		"API key missing. Make sure CENCORI_API_KEY is set in .env.local",
	);
}

// Export a shared Cencori client instance for the rest of the app to use.
export const cencori = new Cencori({ apiKey });

/**
 * Shape of a model object as returned by the Cencori /models endpoint.
 */
export type Model = {
	id: string;
	object: string;
	created?: number;
	owned_by: string;
	name?: string;
	type?: string[];
	context_window?: number;
	description?: string;
};

/**
 * Fetch the list of models supported by the Cencori API.
 *
 * @returns A promise resolving to an array of supported models.
 * @throws If the network call fails or the API returns an error status.
 */
export const fetchSupportedModels = async (): Promise<Model[]> => {
	const baseURL = Bun.env.CENCORI_BASE_URL || "https://api.cencori.com/v1";
	const response = await fetch(`${baseURL}/models`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		throw new Error("Failed to fetch Cencori models");
	}

	const data = (await response.json()) as { data: Model[] };
	return data.data;
};

/** Role a chat message can take in a conversation. */
export type ChatRole = "user" | "assistant" | "system" | "tool";

/** A single message within a chat conversation. */
export type ChatMessage = {
	role: ChatRole;
	content: string;
};

/**
 * Stream a chat completion from the selected model.
 *
 * If no messages are provided, a default system message is injected to
 * describe the harness running the model.
 *
 * @param data Configuration for the request: model id, conversation history,
 *             temperature, and max tokens.
 * @returns The streaming result from the Cencori chat API.
 */
export const queryModelStream = async (data: {
	model_id: string;
	session_messages: ChatMessage[];
	temp: number;
	maxTokens: number;
}) => {
	const messages = data.session_messages.map((m) => ({
		role: m.role,
		content: m.content,
	}));

	if (messages.length === 0) {
		messages.push({
			role: "system",
			content: `You are [fill with your model info] running in the basecode agent harness built by Cencori, an AI infrastructure company.`,
		});
	}

	return cencori.ai.chatStream({
		model: data.model_id,
		messages: messages,
		temperature: data.temp,
		maxTokens: data.maxTokens,
	});
};
