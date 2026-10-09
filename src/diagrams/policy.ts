/** Reject active/embedded content before passing generated source to Mermaid. */
export function diagramPolicyError(source: string): string | null {
	if (!source.trim() || source.length > 65536)
		return "Diagram source must contain 1–65536 characters";
	if (!/^\s*(erDiagram|flowchart|graph|sequenceDiagram)\b/.test(source))
		return "Use an ER, flowchart or sequence diagram";
	if (/%%\{|<[A-Za-z/!]|`|^\s*(click|link|links)\s|javascript\s*:|https?:\/\//im.test(source))
		return "HTML, links, directives and click actions are not supported";
	return null;
}
