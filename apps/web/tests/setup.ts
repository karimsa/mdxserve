// jsdom has no `CSSRuleList`, which Uniwind's web runtime tests stylesheet rules against when
// it loads. A stand-in class lets it load; no rule is ever an instance of it, so Uniwind only
// skips nested rules it would have watched for media query changes.
if (typeof window !== "undefined" && !("CSSRuleList" in globalThis)) {
	Object.defineProperty(globalThis, "CSSRuleList", {
		value: class CSSRuleList {
			readonly length = 0;
		},
	});
}
