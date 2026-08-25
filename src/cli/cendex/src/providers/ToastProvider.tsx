import {
	useContext,
	createContext,
	useState,
	useCallback,
	useEffect,
} from "react";
import { theme } from "../../theme";
import { EmptyBorder } from "../components/InputBar/border";

export type ToastContextValue = {
	show: (message: string | null) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => useContext(ToastContext);

const borderColors: Record<string, string> = {
	success: theme.toast.success,
	error: theme.toast.error,
};

export const Toast = ({
	msg,
	type,
}: {
	msg: string | null;
	type?: string | null;
}) => {
	const toast = useToast();

	useEffect(() => {
		if (!msg || !toast) return;
		const id = setTimeout(() => {
			toast.show(null);
		}, theme.toast.duration);
		return () => clearTimeout(id);
	}, [msg, toast]);

	if (!msg) {
		return null;
	}

	return (
		<box
			backgroundColor={theme.toast.background}
			position="absolute"
			borderColor={borderColors[type ?? ""] ?? theme.toast.notification}
			border={["left", "right"]}
			customBorderChars={{ ...EmptyBorder, vertical: "┃" }}
			width="25%"
			top={1}
			right={2}
			zIndex={1}
			justifyContent="center"
			alignItems="center"
		>
			<box width="100%" justifyContent="center" alignItems="center" padding={1}>
				<text wrapMode="word">{msg}</text>
			</box>
		</box>
	);
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
	const [message, setMessage] = useState<string | null>(null);
	const [type, setType] = useState<string | null>(null);

	const show = useCallback((toastMessage: string | null, type?: string) => {
		setMessage(toastMessage);
		setType(type ?? null);
	}, []);

	return (
		<ToastContext.Provider value={{ show }}>
			<Toast msg={message} type={type} />
			{children}
		</ToastContext.Provider>
	);
};

export default ToastProvider;
