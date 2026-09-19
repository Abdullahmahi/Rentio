import { cn } from "@/lib/utils";

type StatusVariant = "success" | "warning" | "danger" | "info" | "neutral";

const variants: Record<StatusVariant, string> = {
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/25 bg-danger/10 text-danger",
  info: "border-info/25 bg-info/10 text-info",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({
  status,
  variant = "neutral",
}: {
  status: string;
  variant?: StatusVariant;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium",
        variants[variant],
      )}
    >
      {status}
    </span>
  );
}
