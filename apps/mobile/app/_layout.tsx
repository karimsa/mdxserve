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
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { initialDetent, SHEET_DETENTS, UNDIMMED_DETENT } from "../src/comments/sheet";
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
									{/* Full screen, so nothing is drawn under a folded display's vertical bar
									    and a swipe down never fights a pan; its items are native bar items. */}
									<Stack.Screen name="diagram" options={{ presentation: "fullScreenModal" }} />
									{/* The system's own bar, sized by iOS, and none of the tabs' wordmark header.
									    Opaque, as iOS 27 can minimise a translucent bar and draw its items over the
									    content instead of in a folded display's vertical bar. */}
									{/* A sheet the document stays usable behind up to half height, so a highlight
									    there still selects its thread here. Its first height is decided as it
									    opens: short for a document with no threads. No bar: the Open and Resolved
									    control sits under the grabber, and a swipe down closes it. */}
									<Stack.Screen
										name="comments"
										options={({ route }) => ({
											presentation: "formSheet",
											sheetAllowedDetents: SHEET_DETENTS,
											sheetInitialDetentIndex: initialDetent(
												(route.params as { view?: string } | undefined)?.view,
											),
											sheetLargestUndimmedDetentIndex: UNDIMMED_DETENT,
											sheetGrabberVisible: true,
											title: "Comments",
											headerShown: false,
											// Nothing opaque under the sheet's content, so iOS 26's glass shows.
											...(isLiquidGlassAvailable()
												? { contentStyle: { backgroundColor: "transparent" } }
												: {}),
										})}
									/>
									<Stack.Screen
										name="contents"
										options={{
											presentation: "pageSheet",
											title: "Contents",
											headerTransparent: false,
										}}
									/>
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
