import { useCallback, useState } from "react";
import {
	THINKING_WORDS,
	TOOL_THINKING_WORDS,
	TOOL_LEVERAGING_WORDS,
} from "../constants/thinkingWords";
export type ThinkingPhase = "thinking" | "toolThinking" | "toolLeveraging";
const PHASE_WORD_BANKS: Record<ThinkingPhase, readonly string[]> = {
	thinking: THINKING_WORDS,
	toolThinking: TOOL_THINKING_WORDS,
	toolLeveraging: TOOL_LEVERAGING_WORDS,
};
const pickWord = (words: readonly string[], exclude?: string): string => {
	if (words.length <= 1) return words[0] ?? "";
	let next: string;
	do {
		next = words[Math.floor(Math.random() * words.length)] as string;
	} while (next === exclude);
	return next;
};
/**
 * Returns a rotating flavor word plus controls to advance it within the
 * current phase, or switch phases entirely — e.g. general "thinking" while
 * generating, "toolThinking" while the decision loop is figuring out if a
 * tool is needed, "toolLeveraging" once one's actually in use.
 *
 * switchPhase immediately draws a fresh word from the new bank, so the UI
 * reflects the change the moment your agent loop's state changes rather
 * than waiting on the next advance() tick.
 *
 * Default phase and signature match the original hook, so existing
 * `const [word, advance] = useThinkingWord()` call sites are unaffected.
 */
export const useThinkingWord = (
	initialPhase: ThinkingPhase = "thinking",
): [string, () => void, (phase: ThinkingPhase) => void, ThinkingPhase] => {
	const [phase, setPhase] = useState<ThinkingPhase>(initialPhase);
	const [word, setWord] = useState<string>(() =>
		pickWord(PHASE_WORD_BANKS[initialPhase]),
	);
	const advance = useCallback(() => {
		setWord((prev) => pickWord(PHASE_WORD_BANKS[phase], prev));
	}, [phase]);
	const switchPhase = useCallback((nextPhase: ThinkingPhase) => {
		setPhase(nextPhase);
		setWord((prev) => pickWord(PHASE_WORD_BANKS[nextPhase], prev));
	}, []);
	return [word, advance, switchPhase, phase];
};
