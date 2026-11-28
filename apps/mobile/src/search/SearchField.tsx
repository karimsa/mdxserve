import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { useUniwind } from "uniwind";
import { Icon } from "@mdxserve/ui/primitives/Icon";

/** The field's height: iOS's own search fields are this tall, and so is a touch target. */
const FIELD_HEIGHT = 44;

/**
 * The search field, shaped as iOS draws its own: a capsule with a magnifying glass, on Liquid
 * Glass where the system has it (iOS 26 and later) and on the card surface with a border where
 * it does not. It is an ordinary text field inside, not the navigation bar's search controller,
 * which always shows a Cancel control react-native-screens cannot hide.
 */
export function SearchField(props: Omit<TextInputProps, "style" | "className">) {
	const dark = useUniwind().theme === "dark";
	const glass = isLiquidGlassAvailable();
	const field = (
		<>
			<Icon name="search" size="sm" className="text-text-muted" />
			<TextInput
				{...props}
				className="min-w-0 flex-1 font-sans text-text-body"
				style={styles.input}
			/>
		</>
	);
	if (glass) {
		return (
			<GlassView
				glassEffectStyle="regular"
				isInteractive={true}
				colorScheme={dark ? "dark" : "light"}
				style={styles.capsule}
				testID="search-field-capsule"
			>
				{field}
			</GlassView>
		);
	}
	return (
		<View
			style={styles.capsule}
			className="border border-border-default bg-surface-card"
			testID="search-field-capsule"
		>
			{field}
		</View>
	);
}

const styles = StyleSheet.create({
	capsule: {
		height: FIELD_HEIGHT,
		borderRadius: FIELD_HEIGHT / 2,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingHorizontal: 14,
		overflow: "hidden",
	},
	// The whole capsule's height, so a tap anywhere in it lands in the field.
	input: { height: FIELD_HEIGHT, padding: 0 },
});
