import { theme } from "../../../theme";
import Message, { type MessageType } from "../../components/Message";
import InputBar from "../../components/InputBar";
import { useLocation } from "react-router";
import { useEffect } from "react";
import {
	useModels,
	type ModelContextValue,
} from "../../providers/ModelProvider";

import Header from "../../components/Header";

const NewSession = () => {
	const location = useLocation();
	const { setSessionMessages, sessionMessages, respLoading, thinkingWord } =
		useModels() as ModelContextValue;

	useEffect(() => {
		const initialQuery = location.state?.query;
		if (!initialQuery) return;

		setSessionMessages((prev) => [
			...prev,
			{
				msg: initialQuery,
				type: "user",
				id: prev.length + 1,
			},
		]);
	}, [location.state?.query, setSessionMessages]);

	const action = (data: { query?: string }) => {
		if (!data?.query) return;

		setSessionMessages((prev) => [
			...prev,
			{
				msg: data.query,
				type: "user",
				id: sessionMessages.length + 1,
			},
		]);
	};

	return (
		<box
			flexDirection="column"
			height="100%"
			width="100%"
			backgroundColor={theme.backgroundColor}
		>
			<scrollbox flexGrow={1} stickyScroll width="100%" stickyStart="bottom">
				<box flexDirection="column" width="100%">
					<box paddingY={1}>
						<Header />
					</box>

					{sessionMessages?.map((msg: MessageType) => (
						<Message
							key={msg.id}
							msg={msg.msg}
							type={msg.type}
							model={msg.model}
						/>
					))}
					{respLoading && (
						<box
							flexDirection="row"
							alignItems="center"
							paddingX={2}
							paddingY={1}
							gap={1}
						>
							<spinner name="dots" color="#737373" />
							<text fg="#737373">{thinkingWord}</text>
						</box>
					)}
				</box>
			</scrollbox>
			<box flexShrink={0} width="100%">
				<box paddingY={2}>
					<InputBar action={action} />
				</box>
			</box>
		</box>
	);
};

export default NewSession;
