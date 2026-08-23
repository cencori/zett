import { theme } from "../../../theme";
import { EmptyBorder } from "../InputBar/border";
import { MarkdownRenderable, SyntaxStyle, RGBA } from "@opentui/core";

export type MessageType = {
	msg: string;
	type?: "user" | "error" | "bot" | null;
	model?: string;
	id: number;
};

const syntaxStyle = SyntaxStyle.fromStyles({
	default: { fg: RGBA.fromHex("#E6EDF3") },
	"markup.heading.1": { fg: RGBA.fromHex("#58A6FF"), bold: true },
	"markup.heading.2": { fg: RGBA.fromHex("#58A6FF"), bold: true },
	"markup.list": { fg: RGBA.fromHex("#FF7B72") },
	"markup.raw": { fg: RGBA.fromHex("#A5D6FF") },
	"markup.bold": { bold: true },
	"markup.italic": { italic: true },
});

const index = ({ msg, type }: MessageType) => {
	return (
		<box
			borderColor={
				type === "user"
					? theme.message.user.border
					: type === "error"
						? theme.message.error.border
						: theme.backgroundColor
			}
			border={["left"]}
			width="100%"
			customBorderChars={{ ...EmptyBorder, vertical: "┃" }}
		>
			<box
				paddingY={1}
				paddingX={2}
				width="100%"
				backgroundColor={
					type === "user"
						? theme.message.user.background
						: type === "error"
							? theme.message.error.background
							: theme.backgroundColor
				}
			>
				{type === "bot" ? (
					<markdown
						content={msg}
						syntaxStyle={syntaxStyle}
						conceal
						width="100%"
						streaming={true}
					/>
				) : (
					<text width="100%">{msg}</text>
				)}
			</box>
		</box>
	);
};

export default index;
