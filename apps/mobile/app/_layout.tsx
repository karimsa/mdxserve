import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { useColorScheme } from "react-native";
import "../src/global.css";
import { useAppFonts } from "../src/fonts";
import { useVerticalBarBehavior } from "../src/vertical-bar";

/**
 * The providers every screen runs inside: the query cache and the system light or dark theme.
 * Nothing renders until the typefaces have loaded, so no text first shows in the system font.
 */
export default function RootLayout() {
	const [queryClient] = useState(() => new QueryClient());
	const colorScheme = useColorScheme();
	const verticalBarBehavior = useVerticalBarBehavior();
	const fontsReady = useAppFonts();
	if (!fontsReady) return null;
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
				<Stack />
				<StatusBar style="auto" verticalBarBehaviorIOS={verticalBarBehavior} />
			</ThemeProvider>
		</QueryClientProvider>
	);
}
