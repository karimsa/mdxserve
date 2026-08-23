import { AppShell } from "./shell/AppShell";
import { useRouter, type Route } from "./router";

export function App({ initialRoute }: { initialRoute: Route }) {
	const { route, navigate } = useRouter(initialRoute);
	return <AppShell route={route} navigate={navigate} />;
}
