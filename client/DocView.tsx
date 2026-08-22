import { motion } from "framer-motion";
import { fadeRise } from "./motion";
import { docModuleCache, type Route } from "./router";

function ErrorBox({ message }: { message: string }) {
  return (
    <motion.div
      variants={fadeRise}
      initial="initial"
      animate="enter"
      className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <p className="mb-2 font-semibold">Failed to render this page</p>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs">{message}</pre>
    </motion.div>
  );
}

export function DocView({ route }: { route: Extract<Route, { kind: "doc" }> }) {
  const cached = docModuleCache.get(route.path);

  // The router always resolves the module before setting a "doc" route (see
  // client/router.ts loadRoute / the initial-route bootstrap effect), so this
  // is only ever transiently empty on the very first render after boot.
  if (!cached) return null;

  if (cached.status === "error") {
    return <ErrorBox message={cached.message} />;
  }

  const Content = cached.Component;
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <Content />
    </article>
  );
}
