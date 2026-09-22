import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The scroll-reveal wrapper every marketing section is built out of. Ported
 * from Vetra's `components/global/container.tsx`.
 *
 * Staggering comes from the `delay` prop rather than from CSS, which is why
 * sections pass `0.1 + index * 0.1` when mapping a list.
 */
export function Container({
  children,
  className,
  delay = 0.2,
  reverse = false,
  simple = false,
}: {
  children: ReactNode;
  className?: string | undefined;
  delay?: number | undefined;
  reverse?: boolean | undefined;
  simple?: boolean | undefined;
}) {
  // Not optional. Render final, immediately, and never animate.
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={cn("h-full w-full", className)}>{children}</div>;
  }

  return (
    <motion.div
      className={cn("h-full w-full", className)}
      initial={{ opacity: 0, y: reverse ? -20 : 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={
        simple
          ? { delay, duration: 0.2, type: "keyframes" }
          : { delay, duration: 0.4, type: "spring", stiffness: 100 }
      }
    >
      {children}
    </motion.div>
  );
}

export default Container;
