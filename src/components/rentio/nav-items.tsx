import {
  BarChart3,
  Car,
  Building2,
  DoorClosed,
  FileText,
  LayoutDashboard,
  Receipt,
  Users,
  WalletCards,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = readonly [key: string, path: string, icon: LucideIcon];

export const dashboardItem = ["dashboard", "/app", LayoutDashboard] as const;

/**
 * The owner's nav (D11). Settings sits in the sidebar footer; receipts open
 * from Payments; services, access requests and import keep their routes.
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
    items: [
      ["maintenance", "/app/maintenance", Wrench],
      ["parking", "/app/parking", Car],
    ],
  },
] as const;

export const navItems = [
  dashboardItem,
  ...navGroups[0].items,
  ...navGroups[1].items,
  ...navGroups[2].items,
] satisfies NavItem[];
