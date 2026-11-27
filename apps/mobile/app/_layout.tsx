import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { useColorScheme } from "react-native";
import { BlockStateStorageContext } from "@mdxserve/ui/block-state/useBlockState";
import { createMemoryBlockStorage } from "@mdxserve/ui/block-state/storage";
import { ClipboardContext } from "@mdxserve/ui/primitives/clipboard";
import "../src/global.css";
import { copyText } from "../src/clipboard";
import { useAppFonts } from "../src/fonts";
import { useVerticalBarBehavior } from "../src/vertical-bar";

/**
 * The providers every screen runs inside: the query cache, the system light or dark theme,
 * where builtins keep reader state (a table's sort; in memory until the app stores it on the
 * device), and the clipboard the shared components copy to.
 * Nothing renders until the typefaces have loaded, so no text first shows in the system font.
 */
export default function RootLayout() {
	const [queryClient] = useState(() => new QueryClient());
	const [blockStorage] = useState(createMemoryBlockStorage);
	const colorScheme = useColorScheme();
	const verticalBarBehavior = useVerticalBarBehavior();
	const fontsReady = useAppFonts();
	if (!fontsReady) return null;
	return (
		<QueryClientProvider client={queryClient}>
			<BlockStateStorageContext value={blockStorage}>
				<ClipboardContext.Provider value={copyText}>
					<ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
						<Stack />
						<StatusBar style="auto" verticalBarBehaviorIOS={verticalBarBehavior} />
					</ThemeProvider>
				</ClipboardContext.Provider>
			</BlockStateStorageContext>
		</QueryClientProvider>
	);
}
