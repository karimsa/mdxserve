import { z } from "zod";
import { statefulIdProp } from "./id";

// `FileNode` is recursive, so it's declared with z.lazy() rather than inferred
// from a flat schema; authors pass it as a plain JSON-serializable array
// (`nodes={[{ name: "src", children: [...] }]}`), no functions or components.
export interface FileNode {
	name: string;
	path?: string;
	children?: FileNode[];
	open?: boolean;
}

const fileNodeSchema: z.ZodType<FileNode> = z.lazy(() =>
	z.object({
		name: z.string().describe("File or folder name shown in the row."),
		path: z.string().optional().describe("Route/identifier used to match `activePath`."),
		children: z
			.array(fileNodeSchema)
			.optional()
			.describe("Child nodes; presence makes this row a folder."),
		open: z.boolean().optional().describe("Folder starts expanded unless this is `false`."),
	}),
);

export const fileTreeProps = z.object({
	id: statefulIdProp,
	nodes: z.array(fileNodeSchema).default([]).describe("Tree of files/folders to render."),
	activePath: z.string().optional().describe("`path` of the row to highlight as active."),
});

export type FileTreeProps = z.infer<typeof fileTreeProps>;
