import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { applyHeadMetadata } from "./head-metadata";
import { documentQueryOptions } from "./document/query";
import { AppShell } from "./shell/AppShell";
import { titleFor, useRouter, type Route } from "./router";

export function App({ initialRoute }: { initialRoute: Route }) {
	const { route, navigate } = useRouter(initialRoute);
	// The same query DocumentView reads; its metadata replaces what the shell
	// embedded once the tree arrives, and follows edits on disk.
	const { data } = useQuery({
		...documentQueryOptions(route.kind === "doc" ? route.path : ""),
		enabled: route.kind === "doc",
	});
	const metadata = route.kind === "doc" ? (data?.document.metadata ?? route.metadata) : undefined;
	useLayoutEffect(() => {
		applyHeadMetadata(titleFor(route), metadata);
	}, [route, metadata]);
	return <AppShell route={route} navigate={navigate} />;
}
