import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  className?: string | undefined;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    // Below sm the actions drop under the title: side by side at 375px there
    // is not room for both, and the title is what gets clipped.
    <header className={cn("grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto]", className)}>
      <div className="min-w-0">
        {/* Wraps rather than truncating — "Mantenimiento" is not a word to
            show as "Mantenimie…". */}
        <h1 className="text-balance text-2xl font-semibold text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
