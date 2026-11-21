import type { Enums } from "@/lib/database.types";

/** Order shown in pickers. Labels under expenses.categories.* */
export const EXPENSE_CATEGORIES: Enums<"expense_category">[] = [
  "repairs_maintenance",
  "utilities",
  "insurance",
  "taxes",
  "management",
  "supplies",
  "cleaning",
  "landscaping",
  "legal_professional",
  "capital_improvement",
  "other",
];
