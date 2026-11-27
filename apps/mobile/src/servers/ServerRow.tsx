import { View } from "react-native";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Text } from "@mdxserve/ui/primitives/Text";
import { describeServer } from "./status";
import { displayName, type KnownServer } from "./store";
import { useConnection } from "./use-connection";

const STATUS_TONES = { ok: "accent", warn: "body", danger: "body", muted: "muted" } as const;
const STATUS_DOTS = {
	ok: "bg-status-ok-fg",
	warn: "bg-status-warn-fg",
	danger: "bg-status-danger-fg",
	muted: "bg-border-strong",
} as const;

/** One server in the server list: its name, and whether the app can reach it now. */
export function ServerRow({ server, onPress }: { server: KnownServer; onPress: () => void }) {
	const connection = useConnection(server);
	const status = describeServer(server, connection.data, connection.isFetching);
	return (
		<Pressable
			onPress={onPress}
			accessibilityLabel={`${displayName(server)}, ${status.text}`}
			className="flex-row items-center gap-3 border-b border-border-subtle py-3"
		>
			<View className={`h-2 w-2 rounded-full ${STATUS_DOTS[status.tone]}`} />
			<View className="flex-1">
				<Text weight="semibold">{displayName(server)}</Text>
				<Text size="sm" tone={STATUS_TONES[status.tone]}>
					{status.text}
				</Text>
			</View>
			<Icon name="chevron-right" size="sm" className="text-text-subtle" />
		</Pressable>
	);
}
