# Cendex — Codebase Breakdown

## Project Overview

Cendex is a terminal-based chat application built with React and TypeScript, rendered through OpenTUI, a React-based terminal UI toolkit. The application provides a multi-session chat interface with AI model selection, streaming model queries, and extensible tooling. It runs under the Bun runtime and communicates with an AI model API through the Cencori SDK.

The project follows a modular architecture organized around React Context providers for state management, a centralized theme system for visual consistency, and a screen-based layout for navigation.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript |
| Terminal UI | OpenTUI (`@opentui/core`, `@opentui/react`, `@opentui/keymap`) |
| Routing | React Router 8 (in-memory) |
| State Management | React Context API (provider pattern) |
| AI Integration | Cencori SDK, AI SDK (`ai`, `@ai-sdk/*`), OpenAI Codex SDK |
| Styling | Centralized design tokens (`theme.ts`) |
| Runtime | Bun (`bun run --watch src/index.tsx`) |
| Server | Express (dependency) |

## Directory Structure

```text
src/
├── index.tsx                    # Application entry point and router definition
├── providers/                   # Global state management
│   ├── DialogProvider/          # Modal and dialog system
│   │   ├── index.tsx
│   │   └── types.ts
│   ├── ModelProvider.tsx        # AI model selection state
│   └── ToastProvider.tsx        # Transient notification system
├── layouts/                     # Structural components
│   ├── RootLayout.tsx           # Main UI shell and provider wrapper
│   └── screens/                 # Application views
│       ├── Home.tsx             # Primary screen listing sessions/status
│       └── NewSession.tsx       # Configuration of new chat sessions
├── components/                  # Reusable UI elements
│   ├── Message/                 # Chat message rendering
│   ├── StatusBar/               # Connection/status display
│   ├── Header.tsx               # Navigation header
│   ├── ScrollablePicker/        # Wheel-style selector
│   │   ├── index.tsx
│   │   └── types.ts
│   ├── InputBar/                # User input handling
│   │   ├── index.tsx
│   │   └── border.tsx
│   ├── Menu/                    # Command and action system
│   │   ├── index.tsx
│   │   ├── types.ts
│   │   └── commands.tsx
│   └── utils.ts                 # Shared formatting helpers
├── hooks/
│   └── useThinkingWord.ts       # Cycling "thinking" indicator text
├── constants/
│   └── thinkingWords.ts         # Phrases used by the thinking indicator
├── tools/                       # Tool/utility integration
│   ├── harness-plugin-core.ts   # Plugin system core
│   ├── tools.ts                 # Tool implementations
│   └── fileHandler.ts           # File system operations
└── server/
    └── Models.ts                # Model metadata, API client, streaming logic
```

## Core Architecture

### Entry Point (`src/index.tsx`)

The application boots by creating an OpenTUI CLI renderer, mounting an in-memory React Router, and rendering a single `RootLayout` component. The router defines two routes:

- `/` → `Home` screen
- `/new-session` → `NewSession` screen

The renderer is configured with `exitOnCtrlC: false`, meaning the application controls its own lifecycle rather than terminating on Ctrl+C. A default OpenTUI keymap is exported for global key handling.

### State Management (Providers)

Global state is managed through a set of React Context providers:

- **DialogProvider**: Manages the lifecycle and rendering of application-wide modals and dialogs. Exposes a typed context for opening and closing dialogs.
- **ModelProvider**: Tracks the currently selected AI model and exposes selection logic to the UI.
- **ToastProvider**: Maintains a queue of transient notifications (toasts) for user feedback.

All providers are composed inside `RootLayout`, which wraps the routed screens.

### Layout and Navigation

- **RootLayout**: The top-level component that wraps the application in the necessary providers and defines the global visual shell (header, status bar, content area).
- **Screens**:
  - `Home.tsx`: The primary dashboard showing active sessions and connection status.
  - `NewSession.tsx`: Interface for configuring and starting new chat interactions, including model picker, temperature, and token limits.

### UI Components

- **Menu System** (`src/components/Menu/`): A command-driven menu that exposes user actions defined in `commands.tsx`. It serves as the primary interaction mechanism for controlling the application.
- **InputBar**: Handles text entry and submission. Includes a dedicated `border.tsx` module for rendering focused/unfocused border states.
- **ScrollablePicker**: A specialized vertical wheel-style picker used to select items such as models or sessions.
- **Message**: Renders a single chat message with role-based styling.
- **StatusBar**: Displays persistent connection and state information.
- **Header**: Shows navigation context and the application title.
- **useThinkingWord**: A custom hook that cycles through phrases from `constants/thinkingWords.ts` to display ephemeral "thinking" text while the model is responding.

### Server and API Integration (`src/server/Models.ts`)

This module acts as the source of truth for AI model metadata and interaction:

- Reads an API key from the Bun environment (`CENCORI_API_KEY`); the process errors out at startup if the key is missing.
- Instantiates a `Cencori` client with that key.
- Exports TypeScript types for models, chat roles, and chat messages.
- `fetchSupportedModels()`: Retrieves the list of available models from a configurable base URL (defaults to the Cencori v1 endpoint).
- `queryModelStream()`: Streams a chat completion by forwarding session messages to the Cencori client. If the session has no messages yet, a default system message is inserted before the request is sent.

### Tools Layer (`src/tools/`)

- **harness-plugin-core.ts**: Core infrastructure for the plugin harness, providing the hooks by which external or internal functionality can be extended.
- **tools.ts**: Concrete tool implementations used during agent/model interactions.
- **fileHandler.ts**: File I/O operations allowing the application to read and write local files.

## Key Features

1. **Modular Provider Pattern**: Decoupled state logic for dialogs, notifications, and model settings.
2. **Command-Based Menu**: Extensible action system for navigating and controlling the application.
3. **Custom Theme System**: Centralized styling tokens in `theme.ts` for consistent terminal rendering.
4. **Session Management**: Support for creating, viewing, and switching between multiple chat sessions.
5. **Streaming Model Queries**: Real-time streaming chat completions via the Cencori SDK.
6. **Extensible Tooling**: Plugin harness and file-handling utilities for expanding behavior.

## Configuration Files

- `theme.ts`: Defines colors, spacing, and typography tokens used across the UI.
- `tsconfig.json`: TypeScript compiler settings.
- `package.json`: Project dependencies and scripts.
- `.env.local`: Environment-specific variables (e.g., `CENCORI_API_KEY`, `CENCORI_BASE_URL`).
- `ACTIVE_AGENT.json` / `REPO_MAP.json`: Metadata describing the active agent and repository layout.
- `commit.diff`: Snapshot of recent changes for review.

## Dependencies (Highlights)

| Package | Purpose |
|---|---|
| `@opentui/*` | Terminal UI renderer, React bindings, keymaps |
| `react`, `react-router` | UI and routing |
| `cencori` | AI model API client |
| `ai`, `@ai-sdk/*` | Streaming and tool-harness utilities |
| `@openai/codex*` | Codex SDK integration |
| `express` | Server support |
| `axios` | HTTP client utility |
| `opentui-spinner` | Loading spinner component |

## Runtime Notes

- The application is designed to run under Bun: `bun run --watch src/index.tsx`.
- A valid `CENCORI_API_KEY` must be present in `.env.local` at startup.
- The CLI renderer is configured to not exit on Ctrl+C by default, giving the application control over its own lifecycle.