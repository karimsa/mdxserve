import { useEffect, useRef, useState } from "react";

export function LinkDialog({
	onClose,
	onInsert,
}: {
	onClose: () => void;
	onInsert: (link: { href: string; text: string }) => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [href, setHref] = useState("");
	const [text, setText] = useState("");
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	return (
		<dialog
			ref={dialog}
			className="editor-image-dialog"
			aria-labelledby="editor-link-title"
			onCancel={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			}}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (href.trim()) onInsert({ href: href.trim(), text: text.trim() || href.trim() });
				}}
			>
				<h2 id="editor-link-title">Insert link</h2>
				<label>
					URL or path
					<input
						autoFocus
						required
						value={href}
						onChange={(event) => setHref(event.target.value)}
						placeholder="https://… or ./page.md"
					/>
				</label>
				<label>
					Link text
					<input value={text} onChange={(event) => setText(event.target.value)} />
				</label>
				<footer>
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button type="submit" disabled={!href.trim()}>
						Insert link
					</button>
				</footer>
			</form>
		</dialog>
	);
}
