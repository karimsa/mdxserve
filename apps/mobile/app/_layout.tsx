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
import { initialDetent } from "../src/comments/sheet";
import { contentsInitialDetent } from "../src/document/contents";
import { glassSheetOptions } from "../src/glass-sheet";
import { recheckOnNetworkError, wireQueryLifecycle } from "../src/servers/lifecycle";
import { createProbe } from "../src/servers/probe";
import { ServersProvider } from "../src/servers/ServersProvider";
import { useStatusBarStyle } from "../src/status-bar";
import { useVerticalBarBehavior } from "../src/vertical-bar";

/** The `view` key a sheet route was opened with. */
function viewParam(params: unknown): string | undefined {
	const view = (params as { view?: unknown } | undefined)?.view;
	return typeof view === "string" ? view : undefined;
}

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
	const statusBarStyle = useStatusBarStyle();
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
								{/* The status bar's colour follows the app's theme on every screen
								    (src/status-bar.ts). The sheets show the tabs' status bar, the full
								    screen diagram its own; a tab's screens inherit the tabs'. */}
								<Stack screenOptions={{ statusBarStyle }}>
									<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
									{/* Full screen, so nothing is drawn under a folded display's vertical bar
									    and a swipe down never fights a pan; its items are native bar items. */}
									<Stack.Screen name="diagram" options={{ presentation: "fullScreenModal" }} />
									{/* The two sheets share their presentation (src/glass-sheet.ts): the grabber,
									    the same heights and the system's glass where iOS has it. Each first height
									    is decided as the sheet opens. */}
									{/* Comments: no bar; the Open and Resolved control sits under the grabber.
									    Short for a document with no threads, else half height. The document behind
									    it is dimmed, and a tap on it closes the sheet. */}
									<Stack.Screen
										name="comments"
										options={({ route }) => ({
											...glassSheetOptions(initialDetent(viewParam(route.params)), "dimmed"),
											title: "Comments",
											headerShown: false,
										})}
									/>
									{/* Contents: the system's own bar with its title, sized by iOS, and none of
									    the tabs' wordmark header. Not translucent, as iOS 27 can minimise a
									    translucent bar and draw its items over the content instead of in a folded
									    display's vertical bar; over the glass it is unpainted
									    (ContentsScreen.tsx). Half height for a short list, else full; the document
									    behind it stays usable up to half height. */}
									<Stack.Screen
										name="contents"
										options={({ route }) => ({
											...glassSheetOptions(
												contentsInitialDetent(viewParam(route.params)),
												"usable",
											),
											title: "Contents",
											headerTransparent: false,
										})}
									/>
								</Stack>
								{/* Only for the vertical bar's behaviour: iOS takes the status bar's
								    colour from the screens above. */}
								<StatusBar style={statusBarStyle} verticalBarBehaviorIOS={verticalBarBehavior} />
							</ThemeProvider>
						</ClipboardContext.Provider>
					</BlockStateStorageContext>
				</ListingSortProvider>
			</ServersProvider>
		</QueryClientProvider>
	);
}
