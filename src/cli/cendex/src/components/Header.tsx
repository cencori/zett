import path from "node:path";
import { useEffect, useState } from "react";
import { userInfo } from "node:os";

const index = () => {
	const logoPath = path.join(__dirname, "../logo.jpeg");
	const [dir, setDir] = useState<string | null>(null);

	const shortenPath = (
		path: string,
		username: string = userInfo().username,
	): string => {
		return path
			.split("/")
			.filter((segment) => segment !== "home" && segment !== username)
			.join("/");
	};

	const setWorkingDir = async () => {
		setDir(shortenPath(process.cwd()));
	};

	useEffect(() => {
		setWorkingDir();
	}, []);

	return (
		<box
			flexDirection="row"
			alignItems="center"
			gap={1}
			paddingX={2}
			marginTop={-2}
		>
			<image
				source={logoPath}
				fit="fit"
				protocol="auto"
				style={{ width: 12, height: 12 }}
			/>

			<box
				justifyContent="center"
				alignItems="flex-start"
				flexDirection="column"
				paddingX={1}
				paddingY={2}
				gap={0.5}
			>
				<text>
					<strong>Basecode v0.1.0</strong>
				</text>
				<text>Welcome to basecode by cencori!</text>
				{dir && <text>{`~${dir}`}</text>}
			</box>
		</box>
	);
};

export default index;
