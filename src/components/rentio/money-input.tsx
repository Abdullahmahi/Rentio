import { useId } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface MoneyInputProps {
  value: number | "";
  onChange: (value: number | "") => void;
  id?: string | undefined;
  className?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  "aria-invalid"?: boolean | undefined;
}

/** MXN amount field: $ prefix, thousands separators while idle, tabular digits. */
export function MoneyInput({
  value,
  onChange,
  id,
  className,
  placeholder = "0.00",
  disabled,
  ...rest
}: MoneyInputProps) {
  const fallbackId = useId();
  const display = value === "" ? "" : String(value);

  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        id={id ?? fallbackId}
        inputMode="decimal"
        className="numeric pl-7 text-right"
        value={display}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={rest["aria-invalid"]}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^\d.]/g, "");
          if (raw === "") return onChange("");
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : "");
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        MXN
      </span>
    </div>
  );
}
