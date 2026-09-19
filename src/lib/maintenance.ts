import {
  CircleHelp,
  Droplets,
  KeyRound,
  MessageCircle,
  Phone,
  Sparkles,
  User,
  WashingMachine,
  Wrench,
  Zap,
} from "lucide-react";

export const CATEGORY_ICONS = {
  plomeria: Droplets,
  electricidad: Zap,
  cerrajeria: KeyRound,
  electrodomesticos: WashingMachine,
  limpieza: Sparkles,
  otro: CircleHelp,
} as const;

/** `whatsapp` renders today even though nothing writes it yet — the Phase 2
 *  bot will, with no schema change. */
export const SOURCE_ICONS = {
  portal: User,
  whatsapp: MessageCircle,
  telefono: Phone,
  personal: Wrench,
} as const;

export function daysOpen(createdAt: string, resolvedAt: string | null) {
  const end = resolvedAt ? new Date(resolvedAt) : new Date();
  return Math.max(0, Math.floor((end.getTime() - new Date(createdAt).getTime()) / 86_400_000));
}
