import { useAtom } from "jotai";
import { useState, type ReactNode } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Network from "lucide-react/dist/esm/icons/network.mjs";
import PanelsTopLeft from "lucide-react/dist/esm/icons/panels-top-left.mjs";
import SettingsIcon from "lucide-react/dist/esm/icons/settings.mjs";
import CloseIcon from "lucide-react/dist/esm/icons/x.mjs";
import { contentLayoutAtom, tocVisibleAtom, type ContentLayout } from "./state";
import { Modal } from "./ui/Modal";

export function Settings({
	onClose,
	diagrams,
	status,
	saving = false,
}: {
	onClose: () => void;
	diagrams?: ReactNode;
	status?: ReactNode;
	saving?: boolean;
}) {
	const [category, setCategory] = useState<"diagrams" | "layout">(diagrams ? "diagrams" : "layout");
	const [layout, setLayout] = useAtom(contentLayoutAtom);
	const [tocVisible, setTocVisible] = useAtom(tocVisibleAtom);
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
				<aside>
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
				</aside>
				{category === "layout" ? (
					<section>
						<h3>Layout</h3>
						<p>Choose how content fills the available space.</p>
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
						<label className="diagram-setting-row" htmlFor="toc-visibility">
							<span>
								<strong>Table of contents</strong>
								<small>Show the “On this page” navigation beside documents.</small>
							</span>
							<span className="diagram-agent-select">
								<select
									id="toc-visibility"
									value={tocVisible ? "visible" : "hidden"}
									onChange={(event) => setTocVisible(event.target.value === "visible")}
								>
									<option value="visible">Visible</option>
									<option value="hidden">Hidden</option>
								</select>
								<ChevronDown size={14} aria-hidden="true" />
							</span>
						</label>
					</section>
				) : (
					diagrams
				)}
			</div>
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
		</Modal>
	);
}
