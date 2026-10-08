import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpcClient } from "../api";
import { MermaidDiagram } from "../Mermaid";
import { DiagramPreferences } from "./Preferences";
import { Braces, Network, Paperclip, Play, Settings, X } from "lucide-react";

type Draft = { mermaid: string; assumptions: string[]; changes: string[] };
function policy(source: string) {
	return (
		source.length <= 65536 &&
		/^\s*(erDiagram|flowchart|graph|sequenceDiagram)\b/.test(source) &&
		!/%%\{|<[A-Za-z/!]|`|^\s*(click|link|links)\s|javascript\s*:|https?:\/\//im.test(source)
	);
}
export function MermaidDialog({
	onClose,
	onInsert,
}: {
	onClose: () => void;
	onInsert: (source: string) => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const session = useRef(crypto.randomUUID());
	const revision = useRef(0);
	const [text, setText] = useState("");
	const [image, setImage] = useState<{ id: string; url: string; name: string } | null>(null);
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
		dialog.current?.showModal();
		dialog.current?.querySelector("textarea")?.focus();
		const owner = session.current;
		mounted.current = true;
		void trpcClient.getDiagramPreferences
			.query({})
			.then(() => {
				if (mounted.current) {
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
	}, []);
	useEffect(() => {
		const owner = session.current;
		return () => {
			if (image) {
				URL.revokeObjectURL(image.url);
				void trpcClient.discardDiagramImage
					.mutate({ session: owner, imageId: image.id })
					.catch(() => {});
			}
		};
	}, [image]);
	useEffect(() => {
		const changed = () => {
			void trpcClient.getDiagramPreferences
				.query({})
				.then((result) => {
					if (result.agent === "disabled") onClose();
					else {
						setPreferenceVersion((value) => value + 1);
					}
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
				.mutate({ session: session.current, revision: generation })
				.catch(() => {});
		};
		if (manual) {
			setStatus("Editing Mermaid locally");
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
				setStatus("Converting with your local agent…");

				const result = await trpcClient.convertDiagram.mutate({
					session: session.current,
					revision: attempt,
					text,
					imageId: image?.id,
				});
				if (obsolete) return;
				setDraft(result);
				setCurrent(true);
				setStatus(
					`Converted with ${result.provider === "codex" ? "Codex" : "Claude Code"} · review before inserting`,
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
	}, [text, image, uploading, composing, manual, preferenceVersion, settingsReady]);
	const onRender = useCallback(
		(source: string, valid: boolean) => setRendered(valid ? source : ""),
		[],
	);
	async function upload(file: File) {
		setCurrent(false);
		setError("");
		if (
			!["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
			file.size > 10 * 1024 * 1024
		) {
			setError("Choose one PNG, JPEG or WebP image, at most 10 MiB.");
			return;
		}
		const ticket = ++uploadRevision.current;
		setUploading(true);
		setManual(false);
		let uploadedId: string | undefined;
		let adopted = false;
		try {
			const owner = session.current;
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
					.mutate({ session: session.current, imageId: uploadedId })
					.catch(() => {});
			if (mounted.current && ticket === uploadRevision.current) setUploading(false);
		}
	}
	return createPortal(
		<dialog
			ref={dialog}
			className="diagram-dialog diagram-workspace"
			aria-label="Create Mermaid diagram"
			onCancel={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			}}
			onKeyDown={(event) => {
				event.stopPropagation();
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
					<h2>New diagram</h2>
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
						disabled={!draft || !current || rendered !== draft.mermaid || !policy(draft.mermaid)}
						onClick={() => draft && onInsert(draft.mermaid)}
					>
						Insert into draft
					</button>
					<button
						type="button"
						className="diagram-icon-button"
						aria-label="Close diagram dialog"
						onClick={onClose}
					>
						<X size={18} />
					</button>
				</div>
			</header>
			<div className="diagram-workbench">
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
									<X size={15} />
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
			<footer className="diagram-statusbar" data-error={!!error}>
				<span role="status" aria-live="polite">
					{error || status}
				</span>
				<span>{manual ? "Editing locally" : "1s pause · ⌘/Ctrl + Enter · leave editor"}</span>
			</footer>
			{error && (
				<span className="diagram-sr-only" role="alert">
					{error}
				</span>
			)}

			{preferences && <DiagramPreferences onClose={() => setPreferences(false)} />}
		</dialog>,
		document.body,
	);
}
