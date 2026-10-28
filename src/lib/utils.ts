import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Form fields are strings; an empty optional column must be NULL, not "":
 *  the ZIP / state check constraints reject "". */
export const blankToNull = (value: string) => value.trim() || null;
