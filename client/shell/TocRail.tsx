import { TocList } from "../ui/TocList";
import { useToc } from "./useToc";

/** "On this page" rail. Hidden entirely when the doc has no h2s. */
export function TocRail({ path, version }: { path: string; version: number }) {
	const { items, activeId, setActiveId } = useToc(path, version);
	const hasH2 = items.some((item) => item.level === 2);
	if (!hasH2) return null;

	function handleSelect(id: string) {
		setActiveId(id);
		history.replaceState(null, "", `#${id}`);
		document.getElementById(id)?.scrollIntoView({ block: "start" });
	}

	return (
		<div
			data-print-hide
			className="hidden xl:block w-toc shrink-0 self-start ml-10 sticky top-[calc(var(--topbar-height)+40px)]"
		>
			<TocList items={items} activeId={activeId} onSelect={handleSelect} />
		</div>
	);
}
