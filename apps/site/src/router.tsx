import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	type AnchorHTMLAttributes,
	type MouseEvent,
	type ReactNode,
} from "react";

/**
 * A small history-API router. The site has three pages, so a routing library
 * would be more code than the routes themselves.
 */
const PathContext = createContext<{ path: string; navigate: (to: string) => void }>({
	path: "/",
	navigate: () => {},
});

function currentPath(): string {
	const path = window.location.pathname.replace(/\/+$/, "");
	return path === "" ? "/" : path;
}

function scrollToHash(): void {
	const hash = decodeURIComponent(window.location.hash.slice(1));
	const target = hash ? document.getElementById(hash) : null;
	if (target) target.scrollIntoView();
	else window.scrollTo(0, 0);
}

export function RouterProvider({ children }: { children: ReactNode }) {
	const [path, setPath] = useState(currentPath);

	useEffect(() => {
		const onPopState = () => setPath(currentPath());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	useEffect(() => {
		scrollToHash();
	}, [path]);

	const navigate = useCallback((to: string) => {
		const url = new URL(to, window.location.href);
		window.history.pushState(null, "", url.pathname + url.hash);
		setPath(currentPath());
		scrollToHash();
	}, []);

	return <PathContext.Provider value={{ path, navigate }}>{children}</PathContext.Provider>;
}

export function usePath(): string {
	return useContext(PathContext).path;
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
	return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** An in-site link. External URLs should use a plain `<a>`. */
export function Link({
	to,
	children,
	...rest
}: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
	const { path, navigate } = useContext(PathContext);
	const active = to === path;
	return (
		<a
			{...rest}
			href={to}
			aria-current={active ? "page" : undefined}
			onClick={(event) => {
				rest.onClick?.(event);
				if (event.defaultPrevented || isModifiedClick(event)) return;
				event.preventDefault();
				navigate(to);
			}}
		>
			{children}
		</a>
	);
}
