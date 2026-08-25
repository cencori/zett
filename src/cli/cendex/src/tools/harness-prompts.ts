export const buildToolDecisionPrompt = (
	repoMap: string,
) => `You are a precise routing agent. Your single goal is to determine if the user's task requires inspecting a specific file's current, line-by-line code content, or if it can be answered using existing context.

REPO MAP ARCHITECTURE:
${repoMap}

CRITICAL DECISION CRITERIA:
1. TRIGGER (TRUE): You must call the tool if the user asks to debug an error, refactor code, explain logic, or verify implementation details of a file whose contents are NOT fully visible in the chat history.
2. BLOCK (FALSE): Do NOT call the tool if the user is asking about general architecture, asking where a file is located (the Repo Map answers this), or asking a conceptual programming question.
3. EFFICIENCY: Do NOT call the tool if the full code of the target file was already printed verbatim earlier in the conversation history.

STRICT OUTPUT FORMAT:
Return ONLY a valid JSON object matching this schema. No markdown formatting outside the JSON block. No conversational filler.

{
  "needsTool": boolean,
  "confidence": number, // Float between 0.0 and 1.0
  "tool": "peek" | null, // Must be "peek" if needsTool is true, else null
  "targetFiles": string[], // Exact relative paths from the Repo Map
  "actionType": "read" | "write" | "append" | null,
  "reasoning": string // One concise sentence explaining the exact gap in knowledge
}`;

export const buildActionPlanPrompt = (
	taskDescription: string,
	knownContents: string,
) => `Produce the COMPLETE, ORDERED list of file changes needed.
TASK: ${taskDescription}
CURRENT KNOWN FILE CONTENTS:
${knownContents}
RULES:
- If no changes are needed, set "needsChanges": false and "actions": [].
- If ANY change is needed, you MUST list every single one in "actions".
ACTION TYPES:
- "edit": replace ONE exact, unique substring. "target" MUST match the source exactly.
- "write": replace ENTIRE content.
- "append": add content to the END.
OUTPUT FORMAT:
{
  "needsChanges": boolean,
  "actions": [
    {
      "type": "edit" | "write" | "append",
      "path": string,
      "target": string, // only if edit
      "replacement": string, // only if edit
      "content": string, // only if write/append
      "reasoning": string
    }
  ],
  "reasoning": string
}`;

export const buildAgentSystemPrompt = (
	localDir: string,
) => `You are working locally inside: ${localDir}.
TOOL ACCESS: You have NONE in this turn. Every file you need has been fetched.
DO NOT EMIT XML/JSON.
Any file changes the user asked for have ALREADY been applied (see ACTIONS TAKEN below) — just explain what was done in plain language.`;
