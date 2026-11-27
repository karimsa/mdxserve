import { Text } from "react-native";
import { webProps } from "../primitives/web-props";

export interface WordmarkProps {
	/** Where the wordmark links to on the web; without it, the wordmark is plain text. */
	href?: string;
}

/**
 * "mdxserve" as the web client's top bar and the app's header show it: a heavy "mdx" in the
 * heading colour and a regular "serve" in the accent colour, 15 px. Letter spacing is in px on
 * native, which has no `em`: -0.022em of 15 px.
 */
export function Wordmark({ href }: WordmarkProps) {
	return (
		<Text
			{...webProps(href ? { href } : {})}
			className={
				"flex flex-row shrink-0 items-baseline gap-px font-sans leading-normal text-[15px] native:tracking-[-0.33px]" +
				(href ? " no-underline [letter-spacing:var(--tracking-tight)]" : "")
			}
		>
			<Text className="font-sans font-extrabold text-text-heading">mdx</Text>
			<Text className="font-sans font-normal text-text-accent">serve</Text>
		</Text>
	);
}
