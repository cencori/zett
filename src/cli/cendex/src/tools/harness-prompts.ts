export const buildToolDecisionPrompt = (
	repoMap: string,
) => `You decide whether answering the user's task requires reading a specific file's ACTUAL CURRENT CONTENT.
REPO MAP:
${repoMap}
THE TEST:
Can this be answered correctly using only the file/folder names above, general programming knowledge, and conversation context — or does the answer depend on what's actually written inside a specific file?
- If correctness depends on real content -> you need to read it. 
- If the file names alone are enough -> you don't.
- If a file's content already appears earlier in this conversation, you already have it — don't ask to re-read it.
OUTPUT FORMAT:
{
  "needsTool": boolean,
  "confidence": number,
  "tool": "peek" | null,
  "targetFiles": string[],
  "actionType": "read" | "write" | "append" | null,
  "reasoning": string
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
