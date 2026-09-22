import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import React, { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A card whose border and inner wash follow the cursor. Ported from Vetra's
 * `components/ui/magic-card.tsx`.
 *
 * The gradient defaults were Vetra's purple/pink and its border fell back to
 * `hsl(var(--border))`, which is not what --border holds here. Everything now
 * defaults to this project's own tokens, so a card dropped in with no props
 * looks like the rest of the app.
 */
export function MagicCard({
  children,
  className,
  gradientSize = 200,
  gradientColor = "color-mix(in oklab, var(--primary) 10%, transparent)",
  gradientOpacity = 0.8,
  gradientFrom = "var(--primary)",
  gradientTo = "var(--accent)",
}: {
  children?: React.ReactNode;
  className?: string | undefined;
  gradientSize?: number | undefined;
  gradientColor?: string | undefined;
  gradientOpacity?: number | undefined;
  gradientFrom?: string | undefined;
  gradientTo?: string | undefined;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(-gradientSize);
  const mouseY = useMotionValue(-gradientSize);

  // Track against the card's own box, not the page, so the wash lands under
  // the cursor rather than offset by however far the section has scrolled.
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!cardRef.current) return;
      const { left, top } = cardRef.current.getBoundingClientRect();
      mouseX.set(event.clientX - left);
      mouseY.set(event.clientY - top);
    },
    [mouseX, mouseY],
  );

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const reset = () => {
      mouseX.set(-gradientSize);
      mouseY.set(-gradientSize);
    };
    // Vetra bound these to `document`, so every card on the page ran a
    // mousemove handler for the whole page. Scoped to the card instead.
    node.addEventListener("mousemove", handleMouseMove);
    node.addEventListener("mouseleave", reset);
    reset();
    return () => {
      node.removeEventListener("mousemove", handleMouseMove);
      node.removeEventListener("mouseleave", reset);
    };
  }, [handleMouseMove, gradientSize, mouseX, mouseY]);

  const border = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientFrom}, ${gradientTo}, var(--border) 100%)`;
  const wash = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientColor}, transparent 100%)`;

  return (
    <div ref={cardRef} className={cn("group relative flex size-full rounded-xl", className)}>
      <div className="absolute inset-px z-10 rounded-xl bg-surface" />
      <div className="relative z-30 w-full">{children}</div>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-px z-10 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: wash, opacity: gradientOpacity }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl bg-border duration-300 group-hover:opacity-100"
        style={{ background: border }}
      />
    </div>
  );
}

export default MagicCard;
