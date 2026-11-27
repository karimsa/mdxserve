import { useEffect, type ComponentType } from "react";
import { Layout } from "./components/Layout";
import { GetStarted } from "./pages/GetStarted";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { Tour } from "./pages/Tour";
import { usePath } from "./router";

interface Route {
	title: string;
	description: string;
	Page: ComponentType;
}

const routes: Record<string, Route> = {
	"/": {
		title: "mdxserve",
		description: "A folder of Markdown, ready to read in your browser.",
		Page: Home,
	},
	"/get-started": {
		title: "Get started with mdxserve",
		description: "Open your own folder of Markdown and MDX with one command.",
		Page: GetStarted,
	},
	"/tour": {
		title: "Take the mdxserve tour",
		description: "Try tabs, charts, diagrams, and code diffs in a working MDX document.",
		Page: Tour,
	},
};

const notFound: Route = {
	title: "Page not found · mdxserve",
	description: "This page does not exist.",
	Page: NotFound,
};

export function App() {
	const path = usePath();
	const route = routes[path] ?? notFound;

	useEffect(() => {
		document.title = route.title;
		document.querySelector('meta[name="description"]')?.setAttribute("content", route.description);
	}, [route]);

	return (
		<Layout>
			<route.Page />
		</Layout>
	);
}
