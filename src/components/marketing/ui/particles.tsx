import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Circle {
  x: number;
  y: number;
  translateX: number;
  translateY: number;
  size: number;
  alpha: number;
  targetAlpha: number;
  dx: number;
  dy: number;
  magnetism: number;
}

/**
 * Resolve any CSS colour — including the `oklch()` this project's tokens are
 * written in — to plain RGB, by letting the browser paint one pixel and
 * reading it back.
 *
 * Vetra's version was `hexToRgb` and defaulted to "#ffffff", which is
 * invisible on a light background and cannot express a theme token at all.
 */
function resolveRgb(color: string, fallback: [number, number, number]): [number, number, number] {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r ?? fallback[0], g ?? fallback[1], b ?? fallback[2]];
  } catch {
    return fallback;
  }
}

/**
 * Drifting particle field that leans away from the cursor. Ported from Vetra's
 * `components/ui/particles.tsx`.
 *
 * `color` takes a CSS colour rather than a hex, so it can be handed a theme
 * token and follow light/dark without a prop change.
 */
export function Particles({
  className = "",
  quantity = 100,
  staticity = 50,
  ease = 50,
  size = 0.4,
  color = "var(--foreground)",
  vx = 0,
  vy = 0,
}: {
  className?: string | undefined;
  quantity?: number | undefined;
  staticity?: number | undefined;
  ease?: number | undefined;
  size?: number | undefined;
  color?: string | undefined;
  vx?: number | undefined;
  vy?: number | undefined;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const circles = useRef<Circle[]>([]);
  const mouse = useRef({ x: 0, y: 0 });
  const canvasSize = useRef({ w: 0, h: 0 });
  const rafId = useRef<number | null>(null);
  const rgb = useRef<[number, number, number]>([0, 0, 0]);

  // A field of particles is decoration. Under reduced motion it does not draw
  // at all, rather than drawing a still frame — a canvas nobody can see is
  // still a canvas nobody asked for.
  const reduced = useReducedMotion();

  const circleParams = useCallback(
    (): Circle => ({
      x: Math.floor(Math.random() * canvasSize.current.w),
      y: Math.floor(Math.random() * canvasSize.current.h),
      translateX: 0,
      translateY: 0,
      size: Math.floor(Math.random() * 2) + size,
      alpha: 0,
      targetAlpha: Number((Math.random() * 0.6 + 0.1).toFixed(1)),
      dx: (Math.random() - 0.5) * 0.1,
      dy: (Math.random() - 0.5) * 0.1,
      magnetism: 0.1 + Math.random() * 4,
    }),
    [size],
  );

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    contextRef.current = ctx;
    rgb.current = resolveRgb(color, [0, 0, 0]);

    const dpr = window.devicePixelRatio || 1;

    const drawCircle = (circle: Circle, update = false) => {
      const { x, y, translateX, translateY, size: radius, alpha } = circle;
      ctx.translate(translateX, translateY);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(${rgb.current.join(", ")}, ${alpha})`;
      ctx.fill();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!update) circles.current.push(circle);
    };

    const clear = () => ctx.clearRect(0, 0, canvasSize.current.w, canvasSize.current.h);

    const resize = () => {
      canvasSize.current.w = container.offsetWidth;
      canvasSize.current.h = container.offsetHeight;
      canvas.width = canvasSize.current.w * dpr;
      canvas.height = canvasSize.current.h * dpr;
      canvas.style.width = `${canvasSize.current.w}px`;
      canvas.style.height = `${canvasSize.current.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      circles.current = [];
      for (let i = 0; i < quantity; i += 1) drawCircle(circleParams());
    };

    const remap = (value: number, end1: number, end2: number) => {
      const out = (value * end2) / end1;
      return out > 0 ? out : 0;
    };

    const animate = () => {
      clear();
      circles.current.forEach((circle, i) => {
        const edges = [
          circle.x + circle.translateX - circle.size,
          canvasSize.current.w - circle.x - circle.translateX - circle.size,
          circle.y + circle.translateY - circle.size,
          canvasSize.current.h - circle.y - circle.translateY - circle.size,
        ];
        const closest = edges.reduce((a, b) => Math.min(a, b));
        const fade = Number(remap(closest, 20, 1).toFixed(2));
        if (fade > 1) {
          circle.alpha = Math.min(circle.alpha + 0.02, circle.targetAlpha);
        } else {
          circle.alpha = circle.targetAlpha * fade;
        }
        circle.x += circle.dx + vx;
        circle.y += circle.dy + vy;
        circle.translateX +=
          (mouse.current.x / (staticity / circle.magnetism) - circle.translateX) / ease;
        circle.translateY +=
          (mouse.current.y / (staticity / circle.magnetism) - circle.translateY) / ease;

        drawCircle(circle, true);

        const gone =
          circle.x < -circle.size ||
          circle.x > canvasSize.current.w + circle.size ||
          circle.y < -circle.size ||
          circle.y > canvasSize.current.h + circle.size;
        if (gone) {
          circles.current.splice(i, 1);
          drawCircle(circleParams());
        }
      });
      rafId.current = window.requestAnimationFrame(animate);
    };

    const onMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { w, h } = canvasSize.current;
      const x = event.clientX - rect.left - w / 2;
      const y = event.clientY - rect.top - h / 2;
      if (x < w / 2 && x > -w / 2 && y < h / 2 && y > -h / 2) {
        mouse.current = { x, y };
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 200);
    };

    resize();
    animate();
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove);

    return () => {
      if (rafId.current !== null) window.cancelAnimationFrame(rafId.current);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [circleParams, color, ease, quantity, reduced, staticity, vx, vy]);

  if (reduced) return null;

  return (
    <div className={cn("pointer-events-none", className)} ref={containerRef} aria-hidden="true">
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
}

export default Particles;
