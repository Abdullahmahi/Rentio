import { formatMXN } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MoneyText({ value, className }: { value: number; className?: string | undefined }) {
  return <span className={cn("numeric text-right", value < 0 && "text-danger", className)}>{formatMXN(value)}</span>;
}
