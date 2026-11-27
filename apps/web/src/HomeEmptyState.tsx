import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./ui/Icon";
import { TRANSITIONS } from "./motion";

/** What the Copy control puts on the clipboard: the command up to where the path goes. */
const COMMAND_PREFIX = "mdxserve roots add ";

/**
 * The home page when nothing is mounted. The server is up and this page
 * already re-renders itself on `mdxserve:roots-changed`, so the whole view
 * is framed as a server waiting for a folder rather than as an error: one
 * command to run, a quieter agent alternative, and a live status line that
 * says where the server is listening.
 */
export function HomeEmptyState() {
	const [copied, setCopied] = useState(false);
	const host = typeof window === "undefined" ? "" : window.location.host;

	async function copyCommand() {
		try {
			await navigator.clipboard.writeText(COMMAND_PREFIX);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard unavailable (insecure context, permissions); the text is still selectable
		}
	}

	// Layout is all container gaps, no element margins: reset.css zeroes
	// h1/p margins outside any cascade layer, so a `mt-*` utility on them is
	// a no-op while the same class on a div works.
	return (
		<section aria-labelledby="home-empty-heading" className="flex flex-col gap-10 pt-6">
			<div className="flex flex-col gap-2">
				<div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-surface-accent-soft text-text-accent">
					<Icon name="folder-plus" size="lg" />
				</div>
				<h1
					id="home-empty-heading"
					className="font-sans font-bold leading-[1.2] text-[length:var(--size-2xl)] text-text-heading"
				>
					No folders are mounted
				</h1>
				<p className="max-w-[52ch] font-sans leading-relaxed text-[length:var(--size-md)] text-text-muted">
					The server is up and waiting. Mount a folder of Markdown and it appears here on its own,
					no reload needed.
				</p>
			</div>

			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-3 rounded-md border border-code-border bg-code-bg py-2.5 pr-2 pl-3.5 font-mono text-[length:var(--size-sm)] text-code-fg">
					<span aria-hidden="true" className="select-none text-text-subtle">
						$
					</span>
					<code className="min-w-0 flex-1 truncate">
						{COMMAND_PREFIX}
						<span className="text-text-subtle">&lt;dir&gt;</span>
					</code>
					<motion.button
						type="button"
						onClick={copyCommand}
						whileTap={{ scale: 0.94 }}
						transition={TRANSITIONS.snap}
						className={
							"inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-2 font-sans text-[length:var(--size-xs)] font-medium leading-none transition-colors " +
							(copied ? "text-text-accent" : "text-text-subtle hover:text-text-heading")
						}
					>
						<AnimatePresence mode="wait" initial={false}>
							<motion.span
								key={copied ? "done" : "idle"}
								initial={{ opacity: 0, y: -3 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: 3 }}
								transition={TRANSITIONS.fast}
								className="inline-flex items-center gap-1.5"
							>
								<Icon name={copied ? "check" : "copy"} size={13} />
								{copied ? "Copied" : "Copy"}
							</motion.span>
						</AnimatePresence>
					</motion.button>
				</div>
				<p className="font-sans text-[length:var(--size-xs)] leading-relaxed text-text-subtle">
					An agent with the mdxserve skill can run this for you.
				</p>
			</div>

			<p className="flex items-center gap-2.5 font-mono text-[length:var(--size-xs)] text-text-subtle">
				<span aria-hidden="true" className="relative flex h-2 w-2">
					<span className="absolute inline-flex h-full w-full rounded-pill bg-status-ok-fg opacity-60 motion-safe:animate-ping" />
					<span className="relative inline-flex h-2 w-2 rounded-pill bg-status-ok-fg" />
				</span>
				<span>
					Waiting on <span className="text-text-muted">{host}</span>
				</span>
			</p>
		</section>
	);
}
