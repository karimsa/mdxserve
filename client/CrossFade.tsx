import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { enterTransition, fadeSwapTransition } from "./motion";

export interface CrossFadePane {
  key: string;
  node: ReactNode;
  /** Extra props for the pane wrapper (e.g. role="tabpanel", ids). */
  props?: Record<string, unknown>;
}

/**
 * Cross-fades between panes that all stay mounted. Panes are stacked in a
 * single grid cell and the container's height tweens to the active pane's
 * height, so switching never collapses or jumps the layout. Inactive panes
 * are inert and hidden from assistive tech.
 */
export function CrossFade({ active, panes, className }: { active: string; panes: CrossFadePane[]; className?: string }) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = refs.current.get(active);
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, panes.length]);

  return (
    <motion.div
      className={`grid grid-cols-[minmax(0,1fr)] overflow-hidden ${className ?? ""}`}
      initial={false}
      animate={height === null ? undefined : { height }}
      transition={enterTransition}
      style={height === null ? undefined : { height }}
    >
      {panes.map((pane) => {
        const isActive = pane.key === active;
        return (
          <motion.div
            key={pane.key}
            ref={(el) => {
              if (el) refs.current.set(pane.key, el);
              else refs.current.delete(pane.key);
            }}
            className="min-w-0 [grid-area:1/1] self-start"
            initial={false}
            animate={{ opacity: isActive ? 1 : 0 }}
            transition={fadeSwapTransition}
            style={{ pointerEvents: isActive ? "auto" : "none" }}
            inert={!isActive}
            aria-hidden={!isActive}
            {...pane.props}
          >
            {pane.node}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
