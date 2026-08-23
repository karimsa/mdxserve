import { motion, useAnimationControls } from "framer-motion";
import type { ComponentProps } from "react";

/**
 * MDXProvider `input` override. remark-gfm renders task-list items as
 * `<input type="checkbox" disabled>`, which greys them out and swallows
 * clicks. Swap `disabled` for `aria-disabled` so assistive tech still reports
 * the state while the box keeps its accent colour, pin the value with a no-op
 * change handler so clicking can't toggle what the Markdown says, and give a
 * little spring bounce on click so it still feels alive.
 */
export function TaskCheckbox({ disabled: _disabled, ...props }: ComponentProps<"input">) {
	const controls = useAnimationControls();
	if (props.type !== "checkbox") return <input disabled={_disabled} {...props} />;

	function bounce() {
		void controls.start({
			scale: [1, 0.8, 1.2, 1],
			transition: { duration: 0.38, ease: "easeOut", times: [0, 0.25, 0.6, 1] },
		});
	}

	// MDX only ever passes `type` and `checked` here; keep the spread narrow so
	// React's and framer-motion's event prop types don't collide.
	const { type, checked } = props;
	return (
		<motion.input
			type={type}
			checked={Boolean(checked)}
			onChange={() => {}}
			onClick={bounce}
			aria-disabled="true"
			tabIndex={-1}
			animate={controls}
			className="origin-center"
		/>
	);
}
