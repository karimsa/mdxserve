// The app's whole route tree, for renderRouter: every layout and screen under app/, by its path.
import RootLayout from "../app/_layout";
import TabsLayout from "../app/(tabs)/_layout";
import LibraryStack from "../app/(tabs)/(library)/_layout";
import Library from "../app/(tabs)/(library)/index";
import SearchStack from "../app/(tabs)/search/_layout";
import Search from "../app/(tabs)/search/index";
import SearchDocument from "../app/(tabs)/search/s/[serverId]/doc/[...path]";
import ServersStack from "../app/(tabs)/servers/_layout";
import Servers from "../app/(tabs)/servers/index";
import AddServer from "../app/(tabs)/servers/add";
import ScanServer from "../app/(tabs)/servers/scan";
import ServerDetails from "../app/(tabs)/servers/[serverId]";
import Folder from "../app/(tabs)/(library)/s/[serverId]/browse/[...path]";
import LibraryDocument from "../app/(tabs)/(library)/s/[serverId]/doc/[...path]";
import SettingsStack from "../app/(tabs)/settings/_layout";
import Settings from "../app/(tabs)/settings/index";
import Gallery from "../app/(tabs)/(library)/gallery";

export const APP_ROUTES = {
	_layout: RootLayout,
	"(tabs)/_layout": TabsLayout,
	"(tabs)/(library)/_layout": LibraryStack,
	"(tabs)/(library)/index": Library,
	"(tabs)/search/_layout": SearchStack,
	"(tabs)/search/index": Search,
	"(tabs)/search/s/[serverId]/doc/[...path]": SearchDocument,
	"(tabs)/servers/_layout": ServersStack,
	"(tabs)/servers/index": Servers,
	"(tabs)/servers/add": AddServer,
	"(tabs)/servers/scan": ScanServer,
	"(tabs)/servers/[serverId]": ServerDetails,
	"(tabs)/(library)/s/[serverId]/browse/[...path]": Folder,
	"(tabs)/(library)/s/[serverId]/doc/[...path]": LibraryDocument,
	"(tabs)/settings/_layout": SettingsStack,
	"(tabs)/settings/index": Settings,
	"(tabs)/(library)/gallery": Gallery,
};
