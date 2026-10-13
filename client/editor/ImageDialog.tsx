import { useEffect, useRef, useState } from "react";

export function ImageDialog({
	onClose,
	onInsert,
}: {
	onClose: () => void;
	onInsert: (image: { src: string; alt: string; title: string }) => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [src, setSrc] = useState("");
	const [alt, setAlt] = useState("");
	const [title, setTitle] = useState("");
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	return (
		<dialog
			ref={dialog}
			className="editor-image-dialog"
			aria-labelledby="editor-image-title"
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
					if (src.trim()) onInsert({ src: src.trim(), alt, title });
				}}
			>
				<h2 id="editor-image-title">Insert image</h2>
				<label>
					Image URL or path
					<input
						autoFocus
						required
						value={src}
						onChange={(event) => setSrc(event.target.value)}
						placeholder="https://… or ./assets/image.png"
					/>
				</label>
				<label>
					Alternative text
					<input
						value={alt}
						onChange={(event) => setAlt(event.target.value)}
						placeholder="Describe the image"
					/>
				</label>
				<label>
					Title (optional)
					<input value={title} onChange={(event) => setTitle(event.target.value)} />
				</label>
				<footer>
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button type="submit" disabled={!src.trim()}>
						Insert image
					</button>
				</footer>
			</form>
		</dialog>
	);
}
