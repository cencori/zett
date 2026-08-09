import * as React from "react";
import r2wc from "@r2wc/react-to-web-component";
import { AgentChat, type AgentChatProps } from "./App";
// Compiled at build time by scripts/build-web.mjs (Tailwind → CSS), then
// inlined as a string by esbuild's `text` loader. Injected into the shadow
// root so the widget is fully self-contained and style-isolated.
import cssText from "../.gen/agent-chat.css";

function Widget(props: AgentChatProps) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cssText }} />
      <AgentChat {...props} />
    </>
  );
}

const AgentChatElement = r2wc(Widget, {
  shadow: "open",
  props: {
    endpoint: "string",
    agentsEndpoint: "string",
    speechEndpoint: "string",
    transcribeEndpoint: "string",
    agentId: "string",
    theme: "string",
  },
});

if (typeof customElements !== "undefined" && !customElements.get("agent-chat")) {
  customElements.define("agent-chat", AgentChatElement);
}

export { AgentChatElement };
