import React from "react";
import { cn } from "@/lib/utils";

/**
 * Ported from Vetra's `components/ui/orbiting-circles.tsx`.
 *
 * Each child is placed on a circular path by the `orbit` keyframe, which reads
 * --angle, --radius and --duration off the element — so the children stagger
 * without any per-child CSS.
 *
 * Two fixes against the original: the guide ring was `stroke-white/10`, which
 * is invisible on a light background, and the `stroke` prop was concatenated
 * into the class list as a raw colour value ("currentColor"), which is not a
 * class and did nothing.
 */
export function OrbitingCircles({
  className,
  children,
  reverse = false,
  duration = 20,
  radius = 160,
  path = true,
  iconSize = 30,
  speed = 1,
}: {
  className?: string | undefined;
  children?: React.ReactNode;
  reverse?: boolean | undefined;
  duration?: number | undefined;
  radius?: number | undefined;
  path?: boolean | undefined;
  iconSize?: number | undefined;
  speed?: number | undefined;
}) {
  const calculatedDuration = duration / speed;

  return (
    <>
      {path ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          version="1.1"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden
        >
          <circle
            className="stroke-foreground/10 stroke-1"
            strokeDasharray="5 5"
            cx="50%"
            cy="50%"
            r={radius}
            fill="none"
          />
        </svg>
      ) : null}
      {React.Children.map(children, (child, index) => {
        const angle = (360 / React.Children.count(children)) * index;
        return (
          <div
            style={
              {
                "--duration": calculatedDuration,
                "--radius": radius,
                "--angle": angle,
                "--icon-size": `${iconSize}px`,
              } as React.CSSProperties
            }
            className={cn(
              "absolute flex size-[var(--icon-size)] transform-gpu animate-orbit items-center justify-center rounded-full",
              reverse && "[animation-direction:reverse]",
              className,
            )}
          >
            {child}
          </div>
        );
      })}
    </>
  );
}

export default OrbitingCircles;
