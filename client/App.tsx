import { AnimatePresence, motion } from "framer-motion";
import { Fragment } from "react";
import { DocView } from "./DocView";
import { ListingView } from "./ListingView";
import { fadeRise } from "./motion";
import { useRouter, type Route } from "./router";

const CRUMB_LINK_CLASS =
	"text-gray-500 dark:text-gray-400 hover:text-gray-950 dark:hover:text-white";
const CRUMB_SEP_CLASS = "text-gray-300 dark:text-gray-700";

/**
 * Breadcrumb built from the route's path. Every segment is a link ending in
 * "/" except the last segment of a doc/notfound route, which is plain text
 * (matches the previous server-rendered listing.ts/page.ts markup). Plain
 * <a>s: the router's global click delegation handles navigation.
 */
function Breadcrumb({ route }: { route: Route }) {
	const segments = route.path.split("/").filter(Boolean);
	let acc = "";

	return (
		<>
			<a href="/" className={CRUMB_LINK_CLASS}>
				{route.rootName}
			</a>
			{segments.map((seg, i) => {
				acc += `/${seg}`;
				const href = `${acc}/`;
				const isLastPlain = i === segments.length - 1 && route.kind !== "listing";
				return (
					<Fragment key={href}>
						{" "}
						<span className={CRUMB_SEP_CLASS}>/</span>{" "}
						{isLastPlain ? (
							<span>{seg}</span>
						) : (
							<a href={href} className={CRUMB_LINK_CLASS}>
								{seg}
							</a>
						)}
					</Fragment>
				);
			})}
		</>
	);
}

function NotFoundView({ route }: { route: Extract<Route, { kind: "notfound" }> }) {
	return (
		<div>
			<h1 className="mb-4 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">
				Not found
			</h1>
			<p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
				<code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:bg-white/10 dark:text-gray-300">
					{route.path}
				</code>
			</p>
			<a href="/" className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">
				Back to {route.rootName}
			</a>
		</div>
	);
}

export function App({ initialRoute }: { initialRoute: Route }) {
	const { route } = useRouter(initialRoute);

	return (
		<div className="mx-auto max-w-3xl px-6 py-10">
			<AnimatePresence
				mode="wait"
				initial={false}
				onExitComplete={() => window.scrollTo({ top: 0 })}
			>
				<motion.main
					key={route.path}
					variants={fadeRise}
					initial="initial"
					animate="enter"
					exit="exit"
				>
					{route.kind === "listing" ? (
						<>
							<h1 className="mb-6 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">
								<Breadcrumb route={route} />
							</h1>
							<ListingView route={route} />
						</>
					) : route.kind === "doc" ? (
						<>
							<div className="mb-8 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
								<Breadcrumb route={route} />
							</div>
							<DocView route={route} />
						</>
					) : (
						<NotFoundView route={route} />
					)}
				</motion.main>
			</AnimatePresence>
		</div>
	);
}
