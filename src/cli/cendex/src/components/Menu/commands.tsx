import type { DialogContextValue } from "../../providers/DialogProvider";
import type { ToastContextValue } from "../../providers/ToastProvider";
import type { Command } from "./types";
import ScrollablePicker from "../ScrollablePicker";
import { type Model } from "../../server/Models";
import { useNavigate } from "react-router";
import type { MessageType } from "../Message";
import { runLocalMemoryAgentWithRepoContext } from "../../tools/harness-core";

type NavigateFunction = ReturnType<typeof useNavigate>;

type CommandContext = {
	toast: ToastContextValue;
	dialog: DialogContextValue;
	activeModel: Model;
	clearInputBar: () => void;
	models: Model;
	clearContext: () => void;
	navig: NavigateFunction;
	setThinking: (state: boolean) => void;
	sessionMessages: MessageType[];
	mutateSessionMessages: (data: MessageType) => void;
};

const Commands: Command[] = [
	// Session
	{
		title: "New",
		value: "/new",
		description: "Create new session",
		category: "session",
		action: (ctx: CommandContext) => {
			ctx?.toast?.show("New Session!");
			ctx?.navig("/", { replace: true });
			ctx?.clearInputBar();
		},
	},
	{
		title: "Resume",
		value: "/resume",
		description: "Resume a previous session",
		category: "session",
		action: () => {},
	},
	{
		title: "Clear",
		value: "/clear",
		description: "Clear current conversation context",
		category: "session",
		action: (ctx: CommandContext) => {
			ctx?.clearContext();
			ctx?.clearInputBar();
		},
	},
	{
		title: "Compact",
		value: "/compact",
		description: "Summarize and compact context to free up tokens",
		category: "session",
		action: () => {},
	},
	{
		title: "Export",
		value: "/export",
		description: "Export session transcript to file",
		category: "session",
		action: () => {},
	},
	{
		title: "Models",
		value: "/models",
		description: "Switch the active model",
		category: "agent",
		action: (ctx: CommandContext) => {
			ctx?.dialog?.setDialog({
				title: `Select From Cencori ${ctx?.models?.length ?? 0} Models`,
				children: (
					<ScrollablePicker
						models={ctx.models}
						searchPlaceHolder="Search Model..."
					/>
				),
			});
			ctx?.clearInputBar();
		},
	},
	{
		title: "Agents",
		value: "/agents",
		description: "List and manage sub-agents",
		category: "agent",
		action: () => {},
	},
	{
		title: "Spawn",
		value: "/spawn",
		description: "Spawn a sub-agent for a delegated task",
		category: "agent",
		action: () => {},
	},

	// MCP
	{
		title: "mcp",
		value: "/mcp",
		description: "List connected MCP servers and their status",
		category: "mcp",
		action: () => {},
	},
	{
		title: "mcp add",
		value: "/mcp-add",
		description: "Add and connect a new MCP server",
		category: "mcp",
		aliases: ["/mcp:add"],
		action: () => {},
	},
	{
		title: "mcp remove",
		value: "/mcp-remove",
		description: "Disconnect and remove an MCP server",
		category: "mcp",
		aliases: ["/mcp:remove"],
		action: () => {},
	},
	{
		title: "mcp auth",
		value: "/mcp-auth",
		description: "Re-authenticate an MCP server connection",
		category: "mcp",
		aliases: ["/mcp:auth"],
		action: () => {},
	},
	{
		title: "mcp tools",
		value: "/mcp tools",
		description: "List tools exposed by connected MCP servers",
		category: "mcp",
		aliases: ["/mcp:tools"],
		action: () => {},
	},

	// Context / memory
	{
		title: "Init",
		value: "/init",
		description: "Scan project and generate an agent context file",
		category: "context",
		action: async (ctx: CommandContext) => {
			ctx?.clearInputBar();
			ctx?.mutateSessionMessages(
				{
					type: "bot",
					msg: "Generating BASECODE.md",
					model: ctx?.activeModel?.id,
					id: ctx?.sessionMessages.length + 1,
				},
				"/init",
			);
			ctx?.navig("/new-session", { replace: true });
		},
	},
	{
		title: "Add-dir",
		value: "/add-dir",
		description: "Add an additional directory to the agent's scope",
		category: "context",
		action: () => {},
	},
	{
		title: "Memory",
		value: "/memory",
		description: "View or edit persistent agent memory",
		category: "context",
		action: () => {},
	},

	// Tools / permissions
	{
		title: "Permissions",
		value: "/permissions",
		description: "Manage tool and file access permissions",
		category: "tools",
		action: () => {},
	},
	{
		title: "Tools",
		value: "/tools",
		description: "List all available tools and their scopes",
		category: "tools",
		action: () => {},
	},
	{
		title: "Sandbox",
		value: "/sandbox",
		description: "Toggle sandboxed execution mode",
		category: "tools",
		action: () => {},
	},

	// Git / VCS
	{
		title: "Diff",
		value: "/diff",
		description: "Show pending changes made by the agent",
		category: "vcs",
		action: () => {},
	},
	{
		title: "Commit",
		value: "/commit",
		description: "Generate and create a commit for staged changes",
		category: "vcs",
		action: () => {},
	},
	{
		title: "Review",
		value: "/review",
		description: "Review agent-generated changes before applying",
		category: "vcs",
		action: () => {},
	},
	{
		title: "PR",
		value: "/pr",
		description: "Open a pull request for the current branch",
		category: "vcs",
		action: () => {},
	},

	// Meta / utility
	{
		title: "Cost",
		value: "/cost",
		description: "Show token usage and cost for this session",
		category: "meta",
		action: () => {},
	},
	{
		title: "Config",
		value: "/config",
		description: "Open harness configuration",
		category: "meta",
		action: () => {},
	},
	{
		title: "Doctor",
		value: "/doctor",
		description: "Run diagnostics on the harness setup",
		category: "meta",
		action: () => {},
	},
	{
		title: "Login",
		value: "/login",
		description: "Authenticate with the model provider",
		category: "meta",
		action: () => {},
	},
	{
		title: "Logout",
		value: "/logout",
		description: "Sign out of the current provider session",
		category: "meta",
		action: () => {},
	},
	{
		title: "Help",
		value: "/help",
		description: "Show available commands",
		category: "meta",
		action: () => {},
	},
	{
		title: "Bug",
		value: "/bug",
		description: "Report a bug to the maintainers",
		category: "meta",
		action: () => {},
	},
];

export const getFilteredCommands = (targetCmd: string) => {
	const filteredCMDS = Commands.filter((cmd) =>
		cmd.value.toLowerCase().startsWith(targetCmd.toLowerCase()),
	);
	return filteredCMDS.length > 0 ? filteredCMDS : Commands;
};

export default Commands;
