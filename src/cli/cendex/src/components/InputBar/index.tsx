import { useRef, useState, useEffect } from "react";
import { useBindings } from "@opentui/keymap/react";

import StatusBar from "../StatusBar";
import Menu from "../Menu";

import { TextareaRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import {
	useDialog,
	type DialogContextValue,
} from "../../providers/DialogProvider";
import {
	useModels,
	type ModelContextValue,
} from "../../providers/ModelProvider";
import { useToast } from "../../providers/ToastProvider";

const index = ({ action }: { action: (data?: any) => void }) => {
	const [placeHolderText, setPlaceHolder] = useState<string>(
		`Try "Analyze this codebase"`,
	);
	const [query, setQuery] = useState<string>("");
	const [isMenuEnable, setIsMenuEnable] = useState<boolean>(false);
	const { currentDialog } = useDialog() as DialogContextValue;
	const renderer = useRenderer();

	const placeHolderTexts = useRef([
		`Try "Analyze this codebase`,
		`Integrate cencori MCP`,
		`Press "ctrl + q" to quit`,
		`Tokenmaxxing szn?`,
		`Press "ctrl + space" to interrupt`,
	]);
	const [scrollBoxIndex, setScrollBoxIndex] = useState<number>(0);
	const textareaInputRef = useRef<TextareaRenderable>(null);
	const { setRespLoading, interruptedStatusRef } =
		useModels() as ModelContextValue;
	const toast = useToast();

	useBindings(
		() => ({
			priority: 0,
			enabled: currentDialog === null,
			commands: [
				{
					name: "newline",
					run() {
						textareaInputRef.current?.setText(
							textareaInputRef.current.plainText + "\n",
						);
					},
				},
				{
					name: "quit",
					run() {
						renderer.destroy();
					},
				},
				{
					name: "interrupt",
					run: () => {
						if (textareaInputRef.current?.plainText.trim() === "") {
							setRespLoading(false);
							interruptedStatusRef.current = true;
							toast?.show("Thinking Interrupted!", "notification!");
						}
					},
				},
			],
			bindings: [
				{ key: "ctrl+q", cmd: "quit" },
				{ key: "ctrl+space", cmd: "interrupt" },
			],
		}),
		[currentDialog],
	);

	const shufflePlaceHolderText = () => {
		const texts = placeHolderTexts.current;
		setPlaceHolder((prev: string) => {
			const next = texts[Math.floor(Math.random() * texts.length)];
			const text =
				next === prev && texts.length > 1
					? texts[(texts.indexOf(next) + 1) % texts.length]
					: next;
			return text as string;
		});
	};

	const handleSubmit = () => {
		const text = textareaInputRef.current?.plainText ?? "";
		if (text.trim()) {
			textareaInputRef.current?.setText("");
			action({ query: text });
		}
	};

	useEffect(() => {
		const interval = setInterval(shufflePlaceHolderText, 3_000);
		return () => clearInterval(interval);
	}, []);

	return (
		<box width="100%" alignItems="center">
			<box width="100%">
				<StatusBar mode="PLAN MODE" model="Claude Opus 4.6" />
				<box width="100%" borderColor="#fff" border={["top", "bottom"]}>
					<box paddingX={3} width="100%" gap={0.5}>
						<box position="relative" justifyContent="center">
							<box flexDirection="row" gap={2}>
								<text>❯</text>
								<textarea
									ref={textareaInputRef}
									placeholder={placeHolderText}
									placeholderColor={"#505050"}
									onContentChange={() => {
										setIsMenuEnable(
											!!textareaInputRef.current?.plainText.startsWith("/"),
										);

										if (!!textareaInputRef.current?.plainText.startsWith("/")) {
											setQuery(textareaInputRef.current?.plainText);
										}
									}}
									onSubmit={handleSubmit}
									width="100%"
									keyBindings={
										isMenuEnable || currentDialog
											? []
											: [{ name: "return", action: "submit" }]
									}
								/>
							</box>
						</box>
					</box>
				</box>
			</box>
			{isMenuEnable && (
				<Menu
					targetCommand={textareaInputRef.current?.plainText as string}
					scrollBoxIndex={scrollBoxIndex}
					setScrollBoxIndex={setScrollBoxIndex}
					textareaInputRef={textareaInputRef}
				/>
			)}
		</box>
	);
};

export default index;
