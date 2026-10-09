import {
  BarChart3,
  Building2,
  DoorClosed,
  FileText,
  LayoutDashboard,
  Receipt,
  Users,
  WalletCards,
  Wrench,
} from "lucide-react";

export const dashboardItem = ["dashboard", "/app", LayoutDashboard] as const;

/**
 * Only what the owner asked for. Receipts, parking, services, access
 * requests, import and settings keep their routes: receipts open from Pagos,
 * settings from the user menu, the rest by URL.
 */
export const navGroups = [
  {
    label: "portfolio",
    items: [
      ["properties", "/app/properties", Building2],
      ["units", "/app/units", DoorClosed],
      ["tenants", "/app/tenants", Users],
      ["contracts", "/app/contracts", FileText],
    ],
  },
  {
    label: "money",
    items: [
      ["payments", "/app/payments", WalletCards],
      ["expenses", "/app/expenses", Receipt],
      ["reports", "/app/reports", BarChart3],
    ],
  },
  {
    label: "operations",
    items: [["maintenance", "/app/maintenance", Wrench]],
  },
] as const;

export const navItems = [
  dashboardItem,
  ...navGroups[0].items,
  ...navGroups[1].items,
  ...navGroups[2].items,
];
