import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";

export interface ListingEntry {
  name: string;
  isDir: boolean;
  isDoc: boolean;
  size?: number;
}

export type Route =
  | { kind: "listing"; path: string; rootName: string; entries: ListingEntry[] }
  | { kind: "doc"; path: string; rootName: string }
  | { kind: "notfound"; path: string; rootName: string };

export type DocModuleState = { status: "ok"; Component: ComponentType } | { status: "error"; message: string };

/**
 * Modules imported for doc routes, keyed by root-relative path. Shared across
 * the whole SPA session (module scope, not component state) so DocView can
 * render synchronously once a route resolves, and so re-visiting a doc
 * doesn't re-trigger the dynamic import.
 */
export const docModuleCache = new Map<string, DocModuleState>();
const docModulePromises = new Map<string, Promise<void>>();

function ensureDocModule(path: string): Promise<void> {
  if (docModuleCache.has(path)) return Promise.resolve();
  const pending = docModulePromises.get(path);
  if (pending) return pending;

  const promise = import(/* @vite-ignore */ path)
    .then((mod: { default?: ComponentType }) => {
      if (!mod.default) {
        docModuleCache.set(path, { status: "error", message: `${path} has no default export.` });
      } else {
        docModuleCache.set(path, { status: "ok", Component: mod.default });
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      docModuleCache.set(path, { status: "error", message });
    })
    .finally(() => {
      docModulePromises.delete(path);
    });

  docModulePromises.set(path, promise);
  return promise;
}

function titleFor(route: Route): string {
  if (route.kind === "listing") return `${route.rootName}${route.path}`;
  if (route.kind === "doc") {
    const segments = route.path.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? route.rootName;
  }
  return "Not found";
}

interface ListingApiResponse {
  path: string;
  rootName: string;
  entries: ListingEntry[];
}

/**
 * Drives the client-side SPA: resolves a path to a `Route` (fetching the
 * listing JSON API or dynamic-importing a doc module as needed), intercepts
 * same-origin folder/doc link clicks so navigation never triggers a full
 * page load, and keeps `history`/`document.title` in sync.
 */
export function useRouter(initialRoute: Route) {
  const [route, setRoute] = useState<Route>(initialRoute);
  const rootNameRef = useRef(initialRoute.rootName);

  const loadRoute = useCallback(async (path: string): Promise<Route | null> => {
    if (path.endsWith("/")) {
      try {
        const res = await fetch(`/__mdxserve/api/listing?path=${encodeURIComponent(path)}`);
        if (!res.ok) {
          return { kind: "notfound", path, rootName: rootNameRef.current };
        }
        const data = (await res.json()) as ListingApiResponse;
        rootNameRef.current = data.rootName;
        return { kind: "listing", path: data.path, rootName: data.rootName, entries: data.entries };
      } catch {
        return { kind: "notfound", path, rootName: rootNameRef.current };
      }
    }

    if (path.endsWith(".md") || path.endsWith(".mdx")) {
      await ensureDocModule(path);
      return { kind: "doc", path, rootName: rootNameRef.current };
    }

    // Not a listing or a doc: let the browser handle it as a normal navigation.
    window.location.assign(path);
    return null;
  }, []);

  const navigate = useCallback(
    (path: string) => {
      loadRoute(path).then((next) => {
        if (!next) return;
        history.pushState({}, "", path);
        document.title = titleFor(next);
        setRoute(next);
      });
    },
    [loadRoute]
  );

  // The initial route's data comes straight from the server-embedded JSON, but a
  // doc route still needs its module dynamic-imported before DocView has anything
  // to render. Kick that off once on mount and force a re-render when it lands.
  useEffect(() => {
    if (initialRoute.kind !== "doc") return;
    let cancelled = false;
    ensureDocModule(initialRoute.path).then(() => {
      if (cancelled) return;
      setRoute((current) => (current.path === initialRoute.path ? { ...current } : current));
    });
    return () => {
      cancelled = true;
    };
    // Intentionally run once: this only concerns the route the page booted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = titleFor(initialRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onPopState() {
      loadRoute(location.pathname).then((next) => {
        if (!next) return;
        document.title = titleFor(next);
        setRoute(next);
      });
    }
    // We scroll to the top ourselves once the exit transition completes;
    // stop the browser from restoring the old scroll offset over it.
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadRoute]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest("a");
      if (!anchor) return;
      if (anchor.target || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      const pathname = url.pathname;
      if (!(pathname.endsWith("/") || pathname.endsWith(".md") || pathname.endsWith(".mdx"))) return;

      event.preventDefault();
      navigate(pathname);
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);

  return { route, navigate };
}
