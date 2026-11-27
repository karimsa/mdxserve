import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { BlockStateStorageContext } from "@mdxserve/ui/block-state/useBlockState";
import { createMemoryBlockStorage } from "@mdxserve/ui/block-state/storage";
import { ClipboardContext } from "@mdxserve/ui/primitives/clipboard";
import "../src/global.css";
import { copyText } from "../src/clipboard";
import { useAppFonts } from "../src/fonts";
import { ListingSortProvider } from "../src/library/ListingSortProvider";
import { deviceStorage } from "../src/servers/device-storage";
import { recheckOnNetworkError, wireQueryLifecycle } from "../src/servers/lifecycle";
import { createProbe } from "../src/servers/probe";
import { ServersProvider } from "../src/servers/ServersProvider";
import { useVerticalBarBehavior } from "../src/vertical-bar";

function createQueryClient(): QueryClient {
	const queryCache = new QueryCache();
	const queryClient = new QueryClient({ queryCache });
	queryCache.config.onError = recheckOnNetworkError(queryClient);
	return queryClient;
}

/**
 * The providers every screen runs inside: the query cache (paused off line, refreshed in the
 * foreground), the reader's servers, kept on the device, the system light or dark theme, where
 * builtins keep reader state (a table's sort; in memory until the app stores it on the
 * device), and the clipboard the shared components copy to.
 * Nothing renders until the typefaces have loaded, so no text first shows in the system font.
 */
export default function RootLayout() {
	const [queryClient] = useState(createQueryClient);
	const [probe] = useState(() => createProbe());
	const [blockStorage] = useState(createMemoryBlockStorage);
	const colorScheme = useColorScheme();
	const verticalBarBehavior = useVerticalBarBehavior();
	const fontsReady = useAppFonts();
	useEffect(wireQueryLifecycle, []);
	if (!fontsReady) return null;
	return (
		<QueryClientProvider client={queryClient}>
			<ServersProvider storage={deviceStorage} probe={probe}>
				<ListingSortProvider storage={deviceStorage}>
					<BlockStateStorageContext value={blockStorage}>
						<ClipboardContext.Provider value={copyText}>
							<ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
								<Stack>
									<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
								</Stack>
								<StatusBar style="auto" verticalBarBehaviorIOS={verticalBarBehavior} />
							</ThemeProvider>
						</ClipboardContext.Provider>
					</BlockStateStorageContext>
				</ListingSortProvider>
			</ServersProvider>
		</QueryClientProvider>
	);
}
