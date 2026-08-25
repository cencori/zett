import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { useBindings } from "@opentui/keymap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../../providers/DialogProvider";
import { useToast } from "../../providers/ToastProvider";
import type { Model } from "../../server/Models.ts";
import {
	useModels,
	type ModelContextValue,
} from "../../providers/ModelProvider.tsx";
import { writeToFile } from "../../tools/fileHandler.ts";

interface ScrollablePickerProps {
	models: Model[];
	searchPlaceHolder?: string;
}

const ScrollablePicker = ({
	models,
	searchPlaceHolder = "Search models...",
}: ScrollablePickerProps) => {
	const textareaInputRef = useRef<TextareaRenderable | null>(null);
	const scrollBoxRef = useRef<ScrollBoxRenderable | null>(null);
	const [scrollBoxIndex, setScrollBoxIndex] = useState<number>(0);
	const toast = useToast();
	const dialog = useDialog();

	const [filteredModels, setFilteredModels] = useState<Model[]>(models ?? []);
	const { loading, setActiveModel } = useModels() as ModelContextValue;
	const MAX_VISIBLE_ITEMS = Math.min(filteredModels.length, 5) || 1;

	const maxValueWidth =
		useMemo(() => {
			if (filteredModels.length === 0) return 0;
			return Math.max(
				...filteredModels.map((model) => (model.name || model.id).length),
			);
		}, [filteredModels]) + 4;

	useEffect(() => {
		setScrollBoxIndex((prev) =>
			Math.min(prev, Math.max(filteredModels.length - 1, 0)),
		);
	}, [filteredModels.length]);

	useEffect(() => {
		textareaInputRef.current?.focus();
	}, []);

	useEffect(() => {
		setFilteredModels(models);
	}, [models]);

	useBindings(
		() => ({
			priority: 3,
			enabled: true,
			commands: [
				{
					name: "move_up",
					run: () => {
						if (filteredModels.length === 0) return;
						const sb = scrollBoxRef.current;
						const newIndex = Math.max(scrollBoxIndex - 1, 0);
						setScrollBoxIndex(newIndex);
						if (sb && newIndex < sb.scrollTop) {
							sb.scrollTo(newIndex);
						}
					},
				},
				{
					name: "move_down",
					run: () => {
						if (filteredModels.length === 0) return;
						const sb = scrollBoxRef.current;
						const newIndex = Math.min(
							scrollBoxIndex + 1,
							filteredModels.length - 1,
						);
						setScrollBoxIndex(newIndex);
						if (sb) {
							const visibleEnd = sb.scrollTop + sb.viewport.height - 1;
							if (newIndex > visibleEnd) {
								sb.scrollTo(newIndex - sb.viewport.height + 1);
							}
						}
					},
				},
				{
					name: "execute_command",
					run: async () => {
						const selected = filteredModels[scrollBoxIndex];
						if (selected) {
							toast?.show(`Switched to ${selected.name}`);
							try {
								await writeToFile(
									Bun.env?.ACTIVE_MODEL as string,
									JSON.stringify(selected),
								);
							} catch (e) {
								toast?.show("Failed to persist storage", "error");
							}
							setActiveModel(selected);
							dialog?.setDialog(null);
						}
					},
				},
			],
			bindings: [
				{ key: "up", cmd: "move_up" },
				{ key: "down", cmd: "move_down" },
				{ key: "return", cmd: "execute_command" },
			],
		}),
		[scrollBoxIndex, filteredModels, dialog?.currentDialog, toast],
	);

	return (
		<box width="100%" paddingY={1}>
			<textarea
				ref={textareaInputRef}
				placeholder={searchPlaceHolder}
				padding={1}
				placeholderColor={"#505050"}
				onContentChange={() => {
					const query =
						(textareaInputRef.current?.plainText as string)?.toLowerCase() ??
						"";
					setFilteredModels(
						(models ?? []).filter((model) =>
							(model.name || model.id).toLowerCase().startsWith(query),
						),
					);
				}}
			/>
			<scrollbox width="100%" height={MAX_VISIBLE_ITEMS} ref={scrollBoxRef}>
				{!loading &&
					filteredModels.map((model, indx) => {
						const isSelected = indx === scrollBoxIndex;
						return (
							<box
								key={model.id}
								flexDirection="row"
								alignItems="center"
								backgroundColor={isSelected ? "gray" : "transparent"}
							>
								<text
									fg="#fff"
									marginRight={2}
									width={maxValueWidth}
									marginY="auto"
								>
									{model.name || model.id}
								</text>
							</box>
						);
					})}
			</scrollbox>

			{loading && (
				<box justifyContent="center" alignItems="center">
					<box paddingY={1}>
						<spinner name="dots" color="#fff" />
					</box>
				</box>
			)}
		</box>
	);
};

export default ScrollablePicker;
