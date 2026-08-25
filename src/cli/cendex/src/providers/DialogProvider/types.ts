import React from "react";

export type DialogPayload = {
	title: string; //current dialog active
	children?: React.ReactNode;
	type?: string;
};
