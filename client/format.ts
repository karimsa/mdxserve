import { formatDistanceToNow } from "date-fns";

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatModified(mtime: number): string {
	return formatDistanceToNow(mtime, { addSuffix: true });
}
