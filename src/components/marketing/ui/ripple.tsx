import React, { type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Concentric pulsing rings. Ported from Vetra's `components/ui/ripple.tsx`.
 *
 * One real fix: the original set the border with `hsl(var(--foreground), 0.05)`,
 * which assumed --foreground was bare HSL components. In this design system it
 * is an `oklch()` value, so that expression was invalid and every ring border
 * silently fell back to the initial colour. `color-mix` does what was meant.
 */
export const Ripple = React.memo(function Ripple({
  mainCircleSize = 170,
  mainCircleOpacity = 0.24,
  numCircles = 6,
  className,
}: {
  mainCircleSize?: number | undefined;
  mainCircleOpacity?: number | undefined;
  numCircles?: number | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 select-none [mask-image:linear-gradient(to_bottom,white,transparent)]",
        className,
      )}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const size = mainCircleSize + i * 110;
        const opacity = mainCircleOpacity - i * 0.03;
        const borderOpacity = 5 + i * 5;
        return (
          <div
            key={i}
            className="absolute animate-ripple rounded-full border bg-foreground/25 shadow-xl"
            style={
              {
                "--i": i,
                width: `${size}px`,
                height: `${size}px`,
                opacity,
                animationDelay: `${i * 0.06}s`,
                borderStyle: i === numCircles - 1 ? "dashed" : "solid",
                borderWidth: "1px",
                borderColor: `color-mix(in oklab, var(--foreground) ${borderOpacity}%, transparent)`,
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%) scale(1)",
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
});

export default Ripple;
