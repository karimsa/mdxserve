import { NativeTabs } from "expo-router/native-tabs";

/**
 * The app's sections as native tabs (UITabBarController on iOS). The system places them: in
 * the tab bar on a phone, and wherever iOS puts tab items beside a folded display's content.
 * Each tab has its own navigation stack.
 */
export default function TabsLayout() {
	return (
		<NativeTabs>
			<NativeTabs.Trigger name="(library)">
				<NativeTabs.Trigger.Icon
					sf={{ default: "books.vertical", selected: "books.vertical.fill" }}
				/>
				<NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="search">
				<NativeTabs.Trigger.Icon sf="magnifyingglass" />
				<NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="servers">
				<NativeTabs.Trigger.Icon sf="server.rack" />
				<NativeTabs.Trigger.Label>Servers</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
