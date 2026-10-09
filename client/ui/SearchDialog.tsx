import { Modal } from "./Modal";
import {
	useEffect,
	useState,
	type HTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { motion, type MotionProps } from "framer-motion";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { TRANSITIONS } from "../motion";

export interface SearchResult {
	title: ReactNode;
	excerpt?: ReactNode;
	path?: string;
	/** Display path, e.g. "<rootName>/<relative path>"; shown above the title. */
	label?: ReactNode;
	/** Matched query terms; occurrences are highlighted in each field. */
	terms?: string[];
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap every case-insensitive occurrence of `terms` in `text` with `<mark>`. */
function highlight(text: ReactNode, terms: string[] | undefined): ReactNode {
	if (typeof text !== "string" || !terms || terms.length === 0) return text;
	const pattern = terms
		.filter((term) => term.length > 0)
		.sort((first, second) => second.length - first.length)
		.map(escapeRegExp)
		.join("|");
	if (pattern === "") return text;
	const parts = text.split(new RegExp(`(${pattern})`, "gi"));
	return parts.map((part, index) =>
		index % 2 === 1 ? (
			<mark key={index} className="rounded-sm bg-surface-accent-soft text-text-accent">
				{part}
			</mark>
		) : (
			part
		),
	);
}

// `results` shadows a legacy global HTML attribute (a WebKit `<input>` prop
// React still types on `HTMLAttributes`); `Omit` it, along with the
// motion.div-owned event props, before extending.
export interface SearchDialogProps extends Omit<
	HTMLAttributes<HTMLDialogElement>,
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

	function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
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
		}
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			placement="top"
			aria-label="Search docs"
			className={"w-[560px] overflow-hidden " + (className ?? "")}
			onKeyDown={handleKeyDown}
			{...rest}
		>
			<div className="flex h-12 items-center gap-3 border-b border-border-subtle px-4">
				<Icon name="search" size="md" className="text-text-subtle" />
				<input
					autoFocus
					data-bare-focus
					value={query}
					onChange={(event) => onQueryChange?.(event.target.value)}
					placeholder="Search docs"
					className="flex-1 border-0 bg-transparent text-[18px] font-normal text-text-body outline-none placeholder:text-text-subtle"
				/>
				<Kbd>esc</Kbd>
			</div>
			<motion.div layout transition={TRANSITIONS.glide} className="max-h-80 overflow-y-auto p-2">
				{results.length === 0 ? (
					<div className="p-6 text-center text-[13px] leading-normal font-medium text-text-subtle">
						No matches
					</div>
				) : (
					results.map((result, index) => {
						const active = index === highlighted;
						return (
							<motion.div
								key={(result.path ?? "") + index}
								layout
								initial={{ opacity: 0, y: 4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{
									...TRANSITIONS.glide,
									delay: Math.min(index, STAGGER_CAP - 1) * 0.02,
								}}
								onMouseEnter={() => setHighlighted(index)}
								onClick={() => onSelect?.(result)}
								className={
									"flex cursor-pointer items-start gap-3 rounded-md p-2.5 " +
									(active ? "bg-surface-hover" : "bg-transparent")
								}
							>
								<Icon name="file-text" size="sm" className="mt-0.5 text-text-subtle" />
								<div className="min-w-0 flex-1">
									{result.label ? (
										<div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[length:var(--size-2xs)] text-text-subtle">
											{highlight(result.label, result.terms)}
										</div>
									) : null}
									<div className="text-[13px] leading-normal font-semibold text-text-heading">
										{highlight(result.title, result.terms)}
									</div>
									{result.excerpt ? (
										<div className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-normal text-text-muted">
											{highlight(result.excerpt, result.terms)}
										</div>
									) : null}
								</div>
							</motion.div>
						);
					})
				)}
			</motion.div>
		</Modal>
	);
}
