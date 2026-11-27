import type { Route } from "../router";

export function NotFoundView({ route }: { route: Extract<Route, { kind: "notfound" }> }) {
	return (
		<div>
			<h1 className="mb-4 font-sans font-bold leading-[1.2] text-[length:var(--size-3xl)] text-text-heading">
				Not found
			</h1>
			<p className="mb-6">
				<code className="rounded-sm border border-border-default bg-surface-card px-1.5 py-0.5 font-mono text-[length:var(--size-xs)] text-text-muted">
					{route.path}
				</code>
			</p>
			<a
				href={route.rootDir ? `${route.rootDir}/` : "/"}
				className="text-[13px] font-semibold text-text-accent hover:text-text-link-hover"
			>
				Back to {route.rootName ?? "home"}
			</a>
		</div>
	);
}
