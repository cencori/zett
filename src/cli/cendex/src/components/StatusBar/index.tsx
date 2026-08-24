import { theme } from "../../../theme";
import { useModels } from "../../providers/ModelProvider";
import { formatNumber } from "../utils";

const index = ({ mode }: { model: string; mode: string }) => {
	const { activeModel } = useModels();

	return (
		<box width={"100%"} paddingX={2}>
			<box
				flexDirection="row"
				justifyContent="space-between"
				alignItems="center"
				width={"100%"}
			>
				<box flexDirection="row">
					<text fg={theme.inputBar.thinking}>
						{activeModel ? mode : "Waiting"}
					</text>
					<text marginX={1}>*</text>
					{activeModel ? (
						<text>{activeModel?.name}</text>
					) : (
						<box flexDirection="row" gap={1}>
							<spinner name="dots" color="#fff" />
							<text>Please select a model</text>
						</box>
					)}
				</box>
				<box flexDirection="row">
					{activeModel && (
						<text>
							Context Window: {formatNumber(activeModel?.context_window)}
						</text>
					)}
				</box>
			</box>
		</box>
	);
};

export default index;
