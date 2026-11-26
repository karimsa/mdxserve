import { useAtom } from "jotai";
import { useState, type ReactNode } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Network from "lucide-react/dist/esm/icons/network.mjs";
import PanelsTopLeft from "lucide-react/dist/esm/icons/panels-top-left.mjs";
import SettingsIcon from "lucide-react/dist/esm/icons/settings.mjs";
import CloseIcon from "lucide-react/dist/esm/icons/x.mjs";
import { useCompactScreen, useMediaQuery } from "./hooks";
import { contentLayoutAtom, tocModeAtom, type ContentLayout, type TocMode } from "./state";
import { BottomSheet } from "./ui/BottomSheet";
import { Modal } from "./ui/Modal";

const TOC_MODE_HINTS: Record<TocMode, string> = {
	auto: "On the right on larger screens, behind a toolbar button on smaller ones.",
	hidden: "Off the page; a toolbar button brings it out.",
	right: "Beside the document wherever there is room.",
	above: "Between the title and the content.",
	disabled: "No table of contents.",
};

/** Below Tailwind's `md`, where BottomSheet is shown. */
const SHEET_MEDIA = "(max-width: 767px)";

export function Settings({
	onClose,
	diagrams,
	status,
	saving = false,
	nested = false,
}: {
	onClose: () => void;
	diagrams?: ReactNode;
	status?: ReactNode;
	saving?: boolean;
	/** Opened from inside another modal dialog: a sheet would sit inert beneath it, so stay a dialog. */
	nested?: boolean;
}) {
	const [category, setCategory] = useState<"diagrams" | "layout">(diagrams ? "diagrams" : "layout");
	const [layout, setLayout] = useAtom(contentLayoutAtom);
	const [tocMode, setTocMode] = useAtom(tocModeAtom);
	// Phones always fill the width (see useFullWidth), so the choice is moot there.
	const compact = useCompactScreen();
	// At phone width settings are a bottom sheet, like comments and the file list.
	const asSheet = useMediaQuery(SHEET_MEDIA) && !nested;
	// The sheet animates out before the owner unmounts this component.
	const [sheetOpen, setSheetOpen] = useState(true);
	const categories = (
		<>
			<button
				type="button"
				className="diagram-settings-category"
				aria-pressed={category === "layout"}
				onClick={() => setCategory("layout")}
			>
				<PanelsTopLeft size={15} />
				Layout
			</button>
			{diagrams && (
				<button
					type="button"
					className="diagram-settings-category"
					aria-pressed={category === "diagrams"}
					onClick={() => setCategory("diagrams")}
				>
					<Network size={15} />
					Diagrams
				</button>
			)}
		</>
	);

	const content =
		category === "layout" ? (
			<section>
				<h3>Layout</h3>
				<p>Choose how content fills the available space.</p>
				{compact ? null : (
					<label className="diagram-setting-row" htmlFor="content-layout">
						<span>
							<strong>Content layout</strong>
							<small>
								{layout === "flexible"
									? "Drag the bars to resize content."
									: "Content automatically fills the available width."}
							</small>
						</span>
						<span className="diagram-agent-select">
							<select
								id="content-layout"
								value={layout}
								onChange={(event) => setLayout(event.target.value as ContentLayout)}
							>
								<option value="flexible">Flexible</option>
								<option value="full-width">Full width</option>
							</select>
							<ChevronDown size={14} aria-hidden="true" />
						</span>
					</label>
				)}
				<label className="diagram-setting-row" htmlFor="toc-mode">
					<span>
						<strong>Table of contents</strong>
						<small>{TOC_MODE_HINTS[tocMode]}</small>
					</span>
					<span className="diagram-agent-select">
						<select
							id="toc-mode"
							value={tocMode}
							onChange={(event) => setTocMode(event.target.value as TocMode)}
						>
							<option value="auto">Auto</option>
							<option value="hidden">Hidden</option>
							<option value="right">On the right</option>
							<option value="above">Above content</option>
							<option value="disabled">Disabled</option>
						</select>
						<ChevronDown size={14} aria-hidden="true" />
					</span>
				</label>
			</section>
		) : (
			diagrams
		);

	const footer = (
		<footer className="diagram-settings-footer">
			<span>
				{category === "layout" ? (
					"Saved in this browser."
				) : (
					<>
						Also available through <code>mdxserve setup</code>
					</>
				)}
			</span>
			{status ?? <span role="status">Settings save automatically.</span>}
		</footer>
	);

	if (asSheet) {
		const dismiss = () => {
			if (!saving) setSheetOpen(false);
		};
		return (
			<BottomSheet
				open={sheetOpen}
				onClose={dismiss}
				onExitComplete={onClose}
				label="Settings"
				scrim
			>
				{(dragHandlers) => (
					<div className="diagram-dialog diagram-settings settings-sheet">
						<header {...dragHandlers} className="settings-sheet-header">
							<h2>Settings</h2>
							<button
								type="button"
								className="diagram-icon-button"
								aria-label="Close settings"
								disabled={saving}
								onClick={dismiss}
							>
								<CloseIcon size={18} />
							</button>
						</header>
						{/* With one category there is nothing to switch between. */}
						{diagrams ? <nav aria-label="Settings sections">{categories}</nav> : null}
						<div className="diagram-settings-body">{content}</div>
						{footer}
					</div>
				)}
			</BottomSheet>
		);
	}

	return (
		<Modal
			open
			onClose={onClose}
			dismissible={!saving}
			className="diagram-dialog diagram-settings"
			aria-label="Settings"
		>
			<header className="diagram-navbar">
				<div className="diagram-title">
					<SettingsIcon size={17} />
					<h2>Settings</h2>
				</div>
				<button
					type="button"
					className="diagram-icon-button"
					aria-label="Close settings"
					disabled={saving}
					onClick={onClose}
				>
					<CloseIcon size={18} />
				</button>
			</header>
			<div className="diagram-settings-body">
				<aside>{categories}</aside>
				{content}
			</div>
			{footer}
		</Modal>
	);
}
