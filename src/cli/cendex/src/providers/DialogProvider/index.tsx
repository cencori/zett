import { useContext, createContext, useState, useCallback } from "react";

import { useTerminalDimensions } from "@opentui/react";
import { TextAttributes, RGBA } from "@opentui/core";
import type { DialogPayload } from "./types";
import { useBindings } from "@opentui/keymap/react";
import { theme } from "../../../theme";

export type DialogContextValue = {
	currentDialog: DialogPayload | null;
	setDialog: (dialog: DialogPayload | null) => void;
};

const DialogProvider = createContext<DialogContextValue | null>(null);

export const useDialog = () => {
	const value = useContext(DialogProvider);

	if (value) {
		return value;
	}

	return null;
};

const Dialog = ({ currentDialog }: { currentDialog: DialogPayload | null }) => {
	if (!currentDialog) {
		return;
	}

	const { height, width } = useTerminalDimensions();

	return (
		<box
			width={width}
			height={height}
			zIndex={4}
			justifyContent="center"
			alignItems="center"
			position="absolute"
			backgroundColor={RGBA.fromInts(0, 0, 0, 100)}
		>
			<box
				width={Math.min(60, width - 4)}
				height="auto"
				backgroundColor={theme.backgroundColor}
				paddingX={4}
				paddingY={1}
				flexDirection="column"
				gap={1}
				onMouseDown={(e) => e.stopPropagation()}
			>
				<box
					paddingBottom={1}
					flexDirection="row"
					alignItems="center"
					justifyContent="space-between"
				>
					<text attributes={TextAttributes.BOLD}>{currentDialog?.title}</text>
					<text attributes={TextAttributes.BOLD}>ESC</text>
				</box>
				{currentDialog?.type === "text" ? (
					<box flexGrow={1}>
						<text>{currentDialog?.children}</text>
					</box>
				) : (
					<box flexGrow={1}>{currentDialog?.children}</box>
				)}
				<text marginX={"auto"}>Press "q" to close</text>
			</box>
		</box>
	);
};

const index = ({ children }: { children: React.ReactNode }) => {
	const [currentDialog, setCurrentDialog] = useState<DialogPayload | null>(
		null,
	);

	const setDialog = useCallback(
		(dialog: DialogPayload | null) => {
			setCurrentDialog(dialog);
		},
		[setCurrentDialog],
	);

	useBindings(
		() => ({
			priority: 2,
			enabled: currentDialog !== null,
			commands: [
				{
					name: "quit",
					run() {
						setDialog(null);
					},
				},
			],
			bindings: [{ key: "q", cmd: "quit" }],
		}),
		[currentDialog],
	);

	return (
		<DialogProvider.Provider value={{ setDialog, currentDialog }}>
			<Dialog currentDialog={currentDialog} />
			{children}
		</DialogProvider.Provider>
	);
};

export default index;
