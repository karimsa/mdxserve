// TS 7.0.2's DOM lib doesn't (yet) declare the File System Access API this
// module uses (client/export-save.ts). Only what's actually used is declared
// here — trim or extend this file if `yarn typecheck` disagrees.

interface SaveFilePickerOptions {
	suggestedName?: string;
	types?: { description?: string; accept: Record<string, string[]> }[];
}

interface FileSystemWritableFileStream {
	write(data: Blob | BufferSource | string): Promise<void>;
	close(): Promise<void>;
}

interface FileSystemFileHandle {
	createWritable(): Promise<FileSystemWritableFileStream>;
}

interface Window {
	showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

interface UserActivation {
	readonly isActive: boolean;
}

interface Navigator {
	readonly userActivation?: UserActivation;
}
