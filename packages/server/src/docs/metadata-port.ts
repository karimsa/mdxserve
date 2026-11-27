import type { LeadingFrontmatter } from "./frontmatter.js";
import type { DocumentMetadata, MetadataDiagnostic } from "./metadata.js";

/** Static document metadata operations exposed by the document service. */
export interface MetadataPort {
	parseMetadata(
		source: string,
		truncated?: boolean,
	): {
		metadata: DocumentMetadata;
		diagnostics: MetadataDiagnostic[];
	};
	leadingFrontmatter(source: string): LeadingFrontmatter | undefined;
}
