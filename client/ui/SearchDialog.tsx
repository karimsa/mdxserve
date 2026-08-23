import {
	useEffect,
	useState,
	type HTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { AnimatePresence, motion, type MotionProps } from "framer-motion";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { T, V } from "../motion";

export interface SearchResult {
	title: ReactNode;
	excerpt?: ReactNode;
	path?: string;
}

// `results` shadows a legacy global HTML attribute (a WebKit `<input>` prop
// React still types on `HTMLAttributes`); `Omit` it, along with the
// motion.div-owned event props, before extending.
export interface SearchDialogProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"results" | "onSelect" | keyof MotionProps
> {
	open?: boolean;
	query?: string;
	results?: SearchResult[];
	onQueryChange?: (query: string) => void;
	onSelect?: (result: SearchResult) => void;
	onClose?: () => void;
}

const STAGGER_CAP = 5;

/** ⌘K command palette: search the served folder without leaving the page. */
export function SearchDialog({
	open = true,
	query = "",
	results = [],
	onQueryChange,
	onSelect,
	onClose,
	className,
	...rest
}: SearchDialogProps) {
	const [highlighted, setHighlighted] = useState(0);

	useEffect(() => {
		setHighlighted(0);
	}, [query, results, open]);

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setHighlighted((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setHighlighted((current) => Math.max(current - 1, 0));
		} else if (event.key === "Enter") {
			const result = results[highlighted];
			if (result) {
				event.preventDefault();
				onSelect?.(result);
			}
		} else if (event.key === "Escape") {
			event.preventDefault();
			onClose?.();
		}
	}

	return (
		<AnimatePresence>
			{open ? (
				<motion.div
					key="scrim"
					onClick={onClose}
					{...V.scrim}
					className="fixed inset-0 z-[var(--z-modal)] flex justify-center bg-[var(--scrim)] pt-[10vh] backdrop-blur-sm"
				>
					<motion.div
						onClick={(event) => event.stopPropagation()}
						onKeyDown={handleKeyDown}
						{...V.pop}
						className={
							"w-[560px] max-w-[92vw] self-start overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-lg" +
							(className ? " " + className : "")
						}
						{...rest}
					>
						<div className="flex h-12 items-center gap-3 border-b border-border-subtle px-4">
							<Icon name="search" size="md" className="text-text-subtle" />
							<input
								autoFocus
								data-bare-focus
								value={query}
								onChange={(event) => onQueryChange?.(event.target.value)}
								placeholder="Search this folder"
								className="flex-1 border-0 bg-transparent text-[18px] font-normal text-text-body outline-none placeholder:text-text-subtle"
							/>
							<Kbd>esc</Kbd>
						</div>
						<motion.div layout transition={T.glide} className="max-h-80 overflow-y-auto p-2">
							{results.length === 0 ? (
								<div className="p-6 text-center text-[13px] leading-normal font-medium text-text-subtle">
									No matches in this folder
								</div>
							) : (
								results.map((result, i) => {
									const active = i === highlighted;
									return (
										<motion.div
											key={(result.path ?? "") + i}
											layout
											initial={{ opacity: 0, y: 4 }}
											animate={{ opacity: 1, y: 0 }}
											transition={{ ...T.glide, delay: Math.min(i, STAGGER_CAP - 1) * 0.02 }}
											onMouseEnter={() => setHighlighted(i)}
											onClick={() => onSelect?.(result)}
											className={
												"flex cursor-pointer items-start gap-3 rounded-md p-2.5 " +
												(active ? "bg-surface-hover" : "bg-transparent")
											}
										>
											<Icon name="file-text" size="sm" className="mt-0.5 text-text-subtle" />
											<div className="min-w-0 flex-1">
												<div className="text-[13px] leading-normal font-semibold text-text-heading">
													{result.title}
												</div>
												{result.excerpt ? (
													<div className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-normal text-text-muted">
														{result.excerpt}
													</div>
												) : null}
											</div>
											<span className="font-mono text-[length:var(--size-2xs)] text-text-subtle">
												{result.path}
											</span>
										</motion.div>
									);
								})
							)}
						</motion.div>
					</motion.div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
