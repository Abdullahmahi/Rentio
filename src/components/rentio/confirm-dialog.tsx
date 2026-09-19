import { useTranslation } from "react-i18next";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, type ButtonProps } from "@/components/ui/button";

interface ConfirmDialogProps {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  triggerLabel: string;
  triggerVariant?: ButtonProps["variant"];
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ title, description, confirmLabel, cancelLabel, triggerLabel, triggerVariant = "outline", destructive, onConfirm }: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild><Button variant={triggerVariant}>{triggerLabel}</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? t("dialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>{description ?? t("dialog.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel ?? t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined} onClick={onConfirm}>{confirmLabel ?? t("actions.confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
