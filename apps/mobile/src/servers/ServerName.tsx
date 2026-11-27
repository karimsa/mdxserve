import { StyleSheet } from "react-native";
import { Text } from "@mdxserve/ui/primitives/Text";

/**
 * The server a screen belongs to, for the trailing edge of its header (inside a
 * `Stack.Toolbar.View` with `hidesSharedBackground`, so it is plain text, not a bubble).
 * One line, cut at the end when long.
 */
export function ServerName({ name }: { name: string }) {
	return (
		<Text
			size="sm"
			weight="semibold"
			tone="muted"
			numberOfLines={1}
			style={styles.name}
			testID="header-server-name"
		>
			{name}
		</Text>
	);
}

const styles = StyleSheet.create({
	name: { maxWidth: 180 },
});
