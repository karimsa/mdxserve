import { useLayoutEffect } from "react";
import { docModuleCache } from "./doc-module-cache";
import { applyHeadMetadata } from "./head-metadata";
import { AppShell } from "./shell/AppShell";
import { titleFor, useRouter, type Route } from "./router";

export function App({ initialRoute }: { initialRoute: Route }) {
	const { route, navigate } = useRouter(initialRoute);
	useLayoutEffect(() => {
		const cached = route.kind === "doc" ? docModuleCache.get(route.path) : undefined;
		applyHeadMetadata(
			titleFor(route),
			route.kind === "doc"
				? cached?.status === "ok"
					? cached.metadata
					: cached
						? undefined
						: route.metadata
				: undefined,
		);
	}, [route]);
	return <AppShell route={route} navigate={navigate} />;
}
