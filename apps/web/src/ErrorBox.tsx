import { motion } from "framer-motion";
import { fadeRise } from "./motion";

/**
 * Shown in place of a doc's content when it fails to load (DocumentView) or
 * in place of a builtin that threw while rendering (RenderErrorBoundary).
 * Lives in its own file so RenderErrorBoundary can import it without the
 * document view's graph.
 */
export function ErrorBox({ message }: { message: string }) {
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
