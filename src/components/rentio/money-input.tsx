import { useId, useState } from "react";
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

/** USD amount field: $ prefix, right-aligned, tabular digits. */
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
  // Keep what was typed: String(Number("125.")) is "125", which ate the
  // decimal point mid-typing and turned 125.50 into 12550.
  const [text, setText] = useState(value === "" ? "" : String(value));
  const display = text !== "" && Number(text) === value ? text : value === "" ? "" : String(value);

  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        id={id ?? fallbackId}
        inputMode="decimal"
        className="numeric pl-7 pr-3 text-right"
        value={display}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={rest["aria-invalid"]}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^\d.]/g, "");
          setText(raw);
          if (raw === "") return onChange("");
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : "");
        }}
      />
    </div>
  );
}
