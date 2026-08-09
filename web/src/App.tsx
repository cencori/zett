import * as React from "react";
import { Chat } from "./components/chat";

export interface AgentChatProps {
  /** URL each turn is POSTed to. Defaults to the Runtime Contract `/invoke`. */
  endpoint?: string;
  /** Optional URL returning the agent list; enables the agent selector. */
  agentsEndpoint?: string;
  /** Optional URL synthesizing speech for the speak button. */
  speechEndpoint?: string;
  /** Agent id to start on. */
  agentId?: string;
  /** Color theme. Defaults to dark. */
  theme?: "dark" | "light";
}

/**
 * Root of the `<agent-chat>` web component. Wraps the ported chat UI in the
 * `.agent-chat-root` element that scopes the design-token CSS variables, so
 * the same markup themes correctly inside a shadow root or the light DOM.
 */
export function AgentChat({ endpoint, agentsEndpoint, speechEndpoint, agentId, theme }: AgentChatProps) {
  const className = `agent-chat-root${theme === "light" ? " light" : ""}`;
  return (
    <div className={className}>
      <Chat
        endpoint={endpoint}
        agentsEndpoint={agentsEndpoint}
        speechEndpoint={speechEndpoint}
        initialAgentId={agentId}
      />
    </div>
  );
}

export default AgentChat;
