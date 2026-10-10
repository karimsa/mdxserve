import { AnimatePresence } from "framer-motion";
import { sessionId } from "./session-id";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { trpcClient } from "../api";
import { MermaidDiagram } from "../Mermaid";
import { DiagramPreferences } from "./Preferences";
import Braces from "lucide-react/dist/esm/icons/braces.mjs";
import Network from "lucide-react/dist/esm/icons/network.mjs";
import Paperclip from "lucide-react/dist/esm/icons/paperclip.mjs";
import Play from "lucide-react/dist/esm/icons/play.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import CloseIcon from "lucide-react/dist/esm/icons/x.mjs";

type Draft = { mermaid: string; assumptions: string[]; changes: string[] };
function policy(source: string) {
	return (
		source.length <= 65536 &&
		/^\s*(erDiagram|flowchart|graph|sequenceDiagram)\b/.test(source) &&
		!/%%\{|<[A-Za-z/!]|`|^\s*(click|link|links)\s|javascript\s*:|https?:\/\//im.test(source)
	);
}
export function MermaidDialog({
	initialSource,
	directSave = false,
	saving = false,
	saveError = "",
	saveDisabled = false,
	onClose,
	onInsert,
}: {
	initialSource?: string;
	directSave?: boolean;
	saving?: boolean;
	saveError?: string;
	saveDisabled?: boolean;
	onClose: () => void;
	onInsert: (source: string) => void;
}) {
	const [shake, setShake] = useState(0);
	const [session] = useState(sessionId);
	const revision = useRef(0);
	const [text, setText] = useState(initialSource ?? "");
	const [image, setImage] = useState<{ id: string; url: string; name: string } | null>(null);
	const [agentEnabled, setAgentEnabled] = useState(false);
	const [settingsReady, setSettingsReady] = useState(false);
	const gutter = useRef<HTMLDivElement>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [status, setStatus] = useState("Describe a diagram or drop an image.");
	const [error, setError] = useState("");
	const [current, setCurrent] = useState(false);
	const [rendered, setRendered] = useState("");
	const [code, setCode] = useState(false);
	const [preferences, setPreferences] = useState(false);
	const [preferenceVersion, setPreferenceVersion] = useState(0);
	const [uploading, setUploading] = useState(false);
	const [manual, setManual] = useState(false);
	const [composing, setComposing] = useState(false);
	const uploadRevision = useRef(0);
	const mounted = useRef(true);
	const flush = useRef<() => void>(() => {});
	const fileInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (gutter.current) gutter.current.style.transform = "translateY(0)";
	}, [code]);
	useEffect(() => {
		const owner = session;
		mounted.current = true;
		void trpcClient.getDiagramPreferences
			.query({})
			.then((settings) => {
				if (mounted.current) {
					setAgentEnabled(settings.agent !== "disabled");
					setSettingsReady(true);
				}
			})
			.catch(() => {
				if (mounted.current)
					setError("Could not load settings. Close and reopen the dialog to retry.");
			});
		return () => {
			mounted.current = false;
			void trpcClient.releaseDiagramSession.mutate({ session: owner }).catch(() => {});
		};
	}, [session]);
	useEffect(() => {
		const owner = session;
		return () => {
			if (image) {
				URL.revokeObjectURL(image.url);
				void trpcClient.discardDiagramImage
					.mutate({ session: owner, imageId: image.id })
					.catch(() => {});
			}
		};
	}, [image, session]);
	useEffect(() => {
		const changed = () => {
			void trpcClient.getDiagramPreferences
				.query({})
				.then((result) => {
					setAgentEnabled(result.agent !== "disabled");
					setPreferenceVersion((value) => value + 1);
				})
				.catch(() => {});
		};
		window.addEventListener("mdxserve-diagram-preferences", changed);
		return () => window.removeEventListener("mdxserve-diagram-preferences", changed);
	}, [onClose]);
	useEffect(() => {
		if (!settingsReady) return;
		let generation = ++revision.current;
		if (!manual) setCurrent(false);
		setError("");
		flush.current = () => {};
		let obsolete = false;
		const cancel = () => {
			obsolete = true;
			void trpcClient.cancelDiagramConversion
				.mutate({ session: session, revision: generation })
				.catch(() => {});
		};
		if (manual) {
			setStatus("Editing Mermaid locally");
			return cancel;
		}
		if (initialSource !== undefined && text === initialSource && !image) {
			setDraft({ mermaid: initialSource, assumptions: [], changes: [] });
			setCurrent(policy(initialSource));
			setStatus(
				directSave
					? "Edit the source or describe changes, then save the diagram."
					: "Edit the source or describe changes. Update the draft, then save the section.",
			);
			return cancel;
		}
		if (uploading || composing || (!text.trim() && !image)) {
			setStatus(uploading ? "Preparing image…" : "Describe a diagram or drop an image.");
			return cancel;
		}
		setStatus("Waiting for you to pause…");
		let started = false;
		let failed = false;
		let timer: ReturnType<typeof setTimeout>;
		const run = async () => {
			if (obsolete || (started && !failed)) return;
			clearTimeout(timer);
			started = true;
			failed = false;
			setError("");
			const attempt = ++revision.current;
			generation = attempt;
			try {
				// Valid Mermaid stays local. The renderer performs the final insertion check.
				if (!image && policy(text)) {
					const { default: mermaid } = await import("mermaid");
					mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
					let valid = false;
					try {
						valid = !!(await mermaid.parse(text));
					} catch {}
					if (obsolete) return;
					if (valid) {
						setDraft({ mermaid: text, assumptions: [], changes: [] });
						setCurrent(true);
						setStatus("Valid Mermaid · no agent used");
						return;
					}
				}
				if (!agentEnabled) {
					setError("Enter valid Mermaid, or enable an agent in Settings to fix rough input.");
					return;
				}
				setStatus("Converting with your local agent…");

				const result = await trpcClient.convertDiagram.mutate({
					session: session,
					revision: attempt,
					text,
					imageId: image?.id,
				});
				if (obsolete) return;
				setDraft(result);
				setCurrent(true);
				setStatus(
					`Converted with ${result.provider === "codex" ? "Codex" : "Claude Code"} · review before ${directSave ? "saving" : initialSource === undefined ? "inserting" : "updating"}`,
				);
			} catch (failure) {
				if (obsolete) return;
				setError(failure instanceof Error ? failure.message : "Conversion failed");
				setStatus("Automatic conversion paused");
				failed = true;
			}
		};
		flush.current = () => {
			void run();
		};
		timer = setTimeout(() => void run(), 1000);
		return () => {
			clearTimeout(timer);
			cancel();
		};
	}, [
		text,
		image,
		uploading,
		composing,
		manual,
		preferenceVersion,
		settingsReady,
		agentEnabled,
		session,
		initialSource,
		directSave,
	]);
	const onRender = useCallback(
		(source: string, valid: boolean) => setRendered(valid ? source : ""),
		[],
	);
	async function upload(file: File) {
		setError("");
		if (
			!["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
			file.size === 0 ||
			file.size > 10 * 1024 * 1024
		) {
			setError("Choose one PNG, JPEG or WebP image, at most 10 MiB.");
			return;
		}
		if (!agentEnabled) {
			setError("Enable an agent in Settings to convert an image.");
			return;
		}
		setCurrent(false);
		const ticket = ++uploadRevision.current;
		setUploading(true);
		setManual(false);
		let uploadedId: string | undefined;
		let adopted = false;
		try {
			const owner = session;
			const imageId = await trpcClient.beginDiagramImageUpload.mutate({ session: owner });
			uploadedId = imageId;
			const bytes = new Uint8Array(await file.arrayBuffer());
			for (let offset = 0, sequence = 0; offset < bytes.length; offset += 128 * 1024, sequence++) {
				if (!mounted.current || ticket !== uploadRevision.current) return;
				const chunk = bytes.subarray(offset, offset + 128 * 1024);
				let binary = "";
				for (const byte of chunk) binary += String.fromCharCode(byte);
				await trpcClient.appendDiagramImageChunk.mutate({
					session: owner,
					imageId,
					sequence,
					data: btoa(binary),
				});
			}
			await trpcClient.finishDiagramImageUpload.mutate({ session: owner, imageId });
			if (mounted.current && ticket === uploadRevision.current) {
				adopted = true;
				setImage({ id: imageId, url: URL.createObjectURL(file), name: file.name });
			}
		} catch (failure) {
			if (mounted.current && ticket === uploadRevision.current)
				setError(failure instanceof Error ? failure.message : "Could not upload image");
		} finally {
			if (uploadedId && !adopted)
				void trpcClient.discardDiagramImage
					.mutate({ session: session, imageId: uploadedId })
					.catch(() => {});
			if (mounted.current && ticket === uploadRevision.current) setUploading(false);
		}
	}
	const dirty =
		text !== (initialSource ?? "") ||
		!!image ||
		uploading ||
		(draft !== null && draft.mermaid !== (initialSource ?? ""));
	return (
		<Modal
			open
			onClose={onClose}
			className="diagram-dialog diagram-workspace"
			data-shake={shake ? (shake % 2 ? "left" : "right") : undefined}
			initialFocus="textarea"
			dismissible={!saving}
			onBackdropClick={() => {
				if (dirty) setShake((count) => count + 1);
				else onClose();
			}}
			aria-label={initialSource === undefined ? "Create Mermaid diagram" : "Edit Mermaid diagram"}
			onKeyDown={(event) => {
				if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
					event.preventDefault();
					flush.current();
				}
			}}
			onDragOver={(event) => {
				event.preventDefault();
			}}
			onDrop={(event) => {
				event.preventDefault();
				if (event.dataTransfer.files.length !== 1) {
					setError("Drop one image at a time. In Excalidraw, copy as PNG or export an image.");
					return;
				}
				void upload(event.dataTransfer.files[0]);
			}}
			onPaste={(event) => {
				const files = [...event.clipboardData.files];
				if (files.length) {
					event.preventDefault();
					if (files.length === 1) void upload(files[0]);
					else setError("Paste one image at a time.");
				}
			}}
		>
			<header className="diagram-navbar">
				<div className="diagram-title">
					<Network size={18} />
					<h2>{initialSource === undefined ? "New diagram" : "Edit diagram"}</h2>
					<span className="diagram-command">/mermaid</span>
				</div>
				<div className="diagram-actions">
					<button
						type="button"
						className="diagram-icon-button"
						aria-label="Settings"
						title="Settings"
						onClick={() => setPreferences(true)}
					>
						<Settings size={17} />
					</button>
					<button
						type="button"
						className="diagram-primary"
						disabled={
							saving ||
							saveDisabled ||
							!draft ||
							!current ||
							rendered !== draft.mermaid ||
							!policy(draft.mermaid)
						}
						onClick={() => draft && onInsert(draft.mermaid)}
					>
						{saving
							? "Saving…"
							: directSave
								? "Save diagram"
								: initialSource === undefined
									? "Insert into draft"
									: "Update in draft"}
					</button>
					<button
						type="button"
						className="diagram-icon-button"
						aria-label="Close diagram dialog"
						disabled={saving}
						onClick={onClose}
					>
						<CloseIcon size={18} />
					</button>
				</div>
			</header>
			<div className="diagram-workbench" inert={saving}>
				<section className="diagram-editor-pane" aria-label="Diagram source">
					<div className="diagram-pane-toolbar">
						<div className="diagram-tabs" role="tablist" aria-label="Editor content">
							<button
								type="button"
								role="tab"
								aria-selected={!code}
								aria-controls="diagram-editor-panel"
								onClick={() => setCode(false)}
							>
								Input
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={code}
								aria-controls="diagram-editor-panel"
								disabled={!draft}
								onClick={() => setCode(true)}
							>
								<Braces size={14} />
								Mermaid
							</button>
						</div>
						<div className="diagram-actions">
							<button
								type="button"
								className="diagram-icon-button"
								aria-label="Choose image"
								title="Attach image"
								disabled={uploading}
								onClick={() => fileInput.current?.click()}
							>
								<Paperclip size={16} />
							</button>
							<button
								type="button"
								className="diagram-run"
								aria-label="Convert now"
								title="Convert now (⌘/Ctrl + Enter)"
								disabled={!settingsReady || uploading || (!text.trim() && !image)}
								onClick={() => flush.current()}
							>
								<Play size={13} fill="currentColor" />
								<span>Convert</span>
							</button>
						</div>
					</div>
					<div className="diagram-code-editor" role="tabpanel" id="diagram-editor-panel">
						<div className="diagram-gutter" aria-hidden="true">
							<div ref={gutter}>
								{(code ? (draft?.mermaid ?? "") : text).split("\n").map((_, index) => (
									<div key={index}>{index + 1}</div>
								))}
							</div>
						</div>
						<textarea
							key={code ? "mermaid" : "input"}
							id={code ? "diagram-mermaid" : "diagram-input"}
							aria-label={code ? "Generated Mermaid" : "Describe or paste rough Mermaid"}
							spellCheck={false}
							autoCapitalize="off"
							autoCorrect="off"
							wrap="off"
							maxLength={code ? 65536 : 16000}
							value={code ? (draft?.mermaid ?? "") : text}
							placeholder={
								"Describe your diagram…\n\nCustomer has many Orders\nOrder contains one or more LineItems\n\nOr drop an image here."
							}
							onScroll={(event) => {
								if (gutter.current)
									gutter.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
							}}
							onBlur={() => {
								if (!code) flush.current();
							}}
							onCompositionStart={() => setComposing(true)}
							onCompositionEnd={() => setComposing(false)}
							onChange={(event) => {
								const source = event.target.value;
								if (code && draft) {
									setManual(true);
									setDraft({ ...draft, mermaid: source });
									setRendered("");
									setCurrent(policy(source));
								} else {
									setManual(false);
									setText(source);
									setCurrent(false);
								}
							}}
						/>
					</div>
					<input
						ref={fileInput}
						hidden
						type="file"
						accept="image/png,image/jpeg,image/webp"
						onChange={(event) => {
							if (event.target.files?.[0]) void upload(event.target.files[0]);
							event.target.value = "";
						}}
					/>
					{image && (
						<details className="diagram-attachment" open>
							<summary>
								<Paperclip size={13} />
								{image.name}
							</summary>
							<div>
								<img src={image.url} alt="Source diagram" />
								<button
									type="button"
									className="diagram-icon-button"
									aria-label="Remove image"
									onClick={() => {
										setImage(null);
									}}
								>
									<CloseIcon size={15} />
								</button>
							</div>
						</details>
					)}
					<div className="diagram-pane-footer">
						<span>{code ? "Mermaid · editing locally" : "Text or image"}</span>
						<span>{code ? "Changes update the preview" : "PNG, JPEG, WebP · up to 10 MiB"}</span>
					</div>
				</section>
				<section className="diagram-preview-pane" aria-label="Diagram preview">
					<div className="diagram-pane-toolbar">
						<span className="diagram-pane-label">
							<Network size={14} />
							Preview
						</span>
						<span className="diagram-preview-state">
							{draft ? (current ? "Ready" : "Out of date") : "Waiting for input"}
						</span>
					</div>
					<div className={"diagram-canvas" + (!current && draft ? " diagram-stale" : "")}>
						{draft ? (
							policy(draft.mermaid) ? (
								<MermaidDiagram source={draft.mermaid} onRender={onRender} fill />
							) : (
								<p role="alert">
									Use ER, flowchart or sequence Mermaid without HTML, links or directives.
								</p>
							)
						) : (
							<div className="diagram-empty">
								<Network size={36} strokeWidth={1} />
								<strong>Your diagram starts here</strong>
								<span>Write on the left. See it take shape here.</span>
							</div>
						)}
					</div>
					{draft && (draft.assumptions.length > 0 || draft.changes.length > 0) && (
						<details className="diagram-review">
							<summary>
								{draft.assumptions.length
									? `${draft.assumptions.length} assumptions to review`
									: "Conversion notes"}
							</summary>
							<div>
								{draft.assumptions.length > 0 && (
									<ul>
										{draft.assumptions.map((item, index) => (
											<li key={index}>{item}</li>
										))}
									</ul>
								)}
								{draft.changes.length > 0 && (
									<>
										<strong>Changes made</strong>
										<ul>
											{draft.changes.map((item, index) => (
												<li key={index}>{item}</li>
											))}
										</ul>
									</>
								)}
							</div>
						</details>
					)}
					<div className="diagram-pane-footer">
						<span>Mermaid preview</span>
						<span>Drag to pan · scroll to zoom</span>
					</div>
				</section>
			</div>
			<footer className="diagram-statusbar" data-error={!!(saveError || error)}>
				<span role="status" aria-live="polite">
					{saveError ||
						error ||
						(shake && dirty
							? "Unsaved changes — save your diagram or use Close to discard them."
							: status)}
				</span>
				<span>{manual ? "Editing locally" : "1s pause · ⌘/Ctrl + Enter · leave editor"}</span>
			</footer>
			{error && (
				<span className="diagram-sr-only" role="alert">
					{error}
				</span>
			)}

			<AnimatePresence>
				{preferences && <DiagramPreferences onClose={() => setPreferences(false)} />}
			</AnimatePresence>
		</Modal>
	);
}
