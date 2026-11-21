import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import type { Box } from "@/lib/esign";

/** Where a box in PDF points sits on the rendered page, in CSS pixels. */
export type ToCss = (box: Box) => { left: number; top: number; width: number; height: number };

/**
 * pdf.js loads in the browser only (it needs a DOM and a worker), so it is
 * imported on first use; Vite's `?url` gives the worker its hashed path.
 */
async function loadPdf(url: string) {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjs.getDocument({ url });
}

/** A page's visible box (its crop box) in PDF points: what spots clamp to. */
export const pageBounds = (page: PDFPageProxy): Box => {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export function usePdf(url: string | null) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const task = loadPdf(url);
    setDoc(null);
    setError(null);
    task
      .then((loading) => loading.promise)
      .then(
        (value) => !cancelled && setDoc(value),
        (caught: unknown) => !cancelled && setError(caught),
      );
    return () => {
      cancelled = true;
      void task.then((loading) => loading.destroy());
    };
  }, [url]);
  return { doc, error };
}

interface PdfPageProps {
  doc: PDFDocumentProxy;
  /** 1-based. */
  pageNumber: number;
  onClick?: ((point: { x: number; y: number }, bounds: Box) => void) | undefined;
  overlay?: ((toCss: ToCss) => ReactNode) | undefined;
  className?: string | undefined;
}

/** One page, as wide as its container, sharp on retina, with an overlay layer. */
export function PdfPage({ doc, pageNumber, onClick, overlay, className }: PdfPageProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState<PageViewport | null>(null);

  useEffect(() => {
    let cancelled = false;
    void doc.getPage(pageNumber).then((value) => !cancelled && setPage(value));
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry?.contentRect.width ?? 0)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas || width === 0) return;
    const base = page.getViewport({ scale: 1 });
    const next = page.getViewport({ scale: width / base.width });
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(next.width * ratio);
    canvas.height = Math.floor(next.height * ratio);
    canvas.style.width = `${next.width}px`;
    canvas.style.height = `${next.height}px`;
    const task = page.render({
      canvas,
      viewport: next,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    task.promise.then(
      () => setViewport(next),
      () => undefined, // cancelled by a newer render
    );
    return () => task.cancel();
  }, [page, width]);

  const toCss: ToCss = (box) => {
    if (!viewport) return { left: 0, top: 0, width: 0, height: 0 };
    const [ax = 0, ay = 0] = viewport.convertToViewportPoint(box.x, box.y) as number[];
    const [bx = 0, by = 0] = viewport.convertToViewportPoint(
      box.x + box.w,
      box.y + box.h,
    ) as number[];
    return {
      left: Math.min(ax, bx),
      top: Math.min(ay, by),
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
    };
  };

  return (
    <div ref={wrapRef} className={className}>
      <div
        className="relative bg-surface shadow-subtle"
        style={{ minHeight: viewport ? undefined : width * 1.29 }}
        onClick={(event) => {
          if (!onClick || !viewport || !page) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const [x = 0, y = 0] = viewport.convertToPdfPoint(
            event.clientX - rect.left,
            event.clientY - rect.top,
          ) as number[];
          onClick({ x, y }, pageBounds(page));
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t("esign.pageOf", { page: pageNumber, count: doc.numPages })}
          className="block"
        />
        {!viewport ? <Skeleton className="absolute inset-0" /> : null}
        {viewport && overlay ? overlay(toCss) : null}
      </div>
    </div>
  );
}
