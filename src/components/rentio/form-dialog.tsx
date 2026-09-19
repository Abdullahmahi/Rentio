import { useId, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  submitLabel?: string | undefined;
  /** Inline validation message shown above the footer. */
  error?: string | null | undefined;
  pending?: boolean | undefined;
  disabled?: boolean | undefined;
  wide?: boolean | undefined;
  onSubmit: () => void;
  children: ReactNode;
  footerExtra?: ReactNode | undefined;
}

/** Shared shell for the app's ~20 create/edit dialogs: generous field spacing,
 *  an inline error slot, and a pending submit button. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  error,
  pending,
  disabled,
  wide,
  onSubmit,
  children,
  footerExtra,
}: FormDialogProps) {
  const { t } = useTranslation();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || disabled) return;
    onSubmit();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          wide
            ? "max-h-[90vh] overflow-y-auto sm:max-w-3xl"
            : "max-h-[90vh] overflow-y-auto sm:max-w-lg"
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {children}
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex items-center">{footerExtra}</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={pending || disabled}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {submitLabel ?? t("actions.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Label + control + optional hint/error, at the 16px rhythm forms use.
 *
 * With `htmlFor` the label binds to the input directly. Without it — a Select
 * or another composite that owns no single input id — the label names a
 * labelled group instead, so the control is still announced with its label
 * rather than on its own.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  const generatedId = useId();
  const labelId = `${generatedId}-label`;
  const describedById = `${generatedId}-description`;
  const description = error ?? hint;

  return (
    <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
      <label id={labelId} htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {htmlFor ? (
        children
      ) : (
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={description ? describedById : undefined}
        >
          {children}
        </div>
      )}
      {error ? (
        <p id={describedById} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={describedById} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
