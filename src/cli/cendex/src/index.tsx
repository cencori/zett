import "opentui-spinner/react";

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";

import { createMemoryRouter, RouterProvider } from "react-router";

import RootLayout from "./layouts/RootLayout";
import Home from "./layouts/screens/Home";
import NewSession from "./layouts/screens/NewSession";

const router = createMemoryRouter([
	{
		path: "/",
		element: <RootLayout />,
		children: [
			{
				index: true,
				element: <Home />,
			},
			{
				path: "/new-session",
				element: <NewSession />,
			},
		],
	},
]);
const renderer = await createCliRenderer({ exitOnCtrlC: false });
export const keymap = createDefaultOpenTuiKeymap(renderer);

createRoot(renderer).render(<RouterProvider router={router} />);
