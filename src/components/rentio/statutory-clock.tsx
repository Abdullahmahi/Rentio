import { Scale } from "lucide-react";
import { cn } from "@/lib/utils";

export type ClockTone = "neutral" | "warning" | "danger";

const tones: Record<ClockTone, string> = {
  neutral: "border-border text-muted-foreground",
  warning: "border-warning/50 text-warning",
  danger: "border-danger/50 text-danger",
};

/**
 * A legal deadline, not a workflow step.
 *
 * Deliberately a different shape from StatusBadge: square corners, a border
 * and no fill, against StatusBadge's filled pill. A statutory countdown and a
 * kanban status are different kinds of fact and should not be read as the same
 * kind of chip — one is "where this sits in our process", the other is "how
 * long the Property Code gives us".
 */
export function StatutoryClock({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: ClockTone | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "numeric inline-flex min-h-6 items-center gap-1.5 text-balance rounded-md border bg-transparent px-2 py-0.5 text-left text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      <Scale className="size-3.5 shrink-0 self-start" aria-hidden />
      {label}
    </span>
  );
}
