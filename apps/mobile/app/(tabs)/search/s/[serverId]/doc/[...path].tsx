import { DocumentScreen } from "../../../../../../src/document/DocumentScreen";

/**
 * A document opened from a search result, inside the Search tab so that going back returns to
 * the results. Its links to other documents open in this tab too.
 */
export default function SearchDocument() {
	return <DocumentScreen documentRoute="/search/s/[serverId]/doc/[...path]" />;
}
