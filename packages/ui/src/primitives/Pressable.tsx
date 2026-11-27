import type { ComponentProps } from "react";
import { Pressable as NativePressable } from "react-native";

export interface PressableProps extends Omit<ComponentProps<typeof NativePressable>, "role"> {
	/** What the control is to assistive technology; a `<button>` on the web by default. */
	role?: "button" | "link" | "tab" | "checkbox" | "menuitem";
	className?: string;
}

/**
 * Something to press. On the web it is a real `<button>` (react-native-web maps the role), so
 * it takes focus, answers Enter and Space, and gets the global focus ring.
 */
export function Pressable({ role = "button", className = "", ...props }: PressableProps) {
	return <NativePressable {...props} role={role} className={`cursor-pointer ${className}`} />;
}
