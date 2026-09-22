import {
  BarChart3,
  Building2,
  CarFront,
  DoorClosed,
  FileText,
  Inbox,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Upload,
  Users,
  WalletCards,
  Wrench,
  Zap,
} from "lucide-react";

export const dashboardItem = ["dashboard", "/app", LayoutDashboard] as const;

/** Thirteen equal items is a list of links; three groups is a tool. */
export const navGroups = [
  {
    label: "portfolio",
    items: [
      ["properties", "/app/properties", Building2],
      ["units", "/app/units", DoorClosed],
      ["parking", "/app/parking", CarFront],
      ["tenants", "/app/tenants", Users],
      ["contracts", "/app/contracts", FileText],
    ],
  },
  {
    label: "money",
    items: [
      ["receipts", "/app/receipts", ReceiptText],
      ["payments", "/app/payments", WalletCards],
      ["services", "/app/services", Zap],
      ["reports", "/app/reports", BarChart3],
    ],
  },
  {
    label: "operations",
    items: [
      ["maintenance", "/app/maintenance", Wrench],
      ["requests", "/app/requests", Inbox],
      ["import", "/app/import", Upload],
      ["settings", "/app/settings", Settings],
    ],
  },
] as const;

export const navItems = [
  dashboardItem,
  ...navGroups[0].items,
  ...navGroups[1].items,
  ...navGroups[2].items,
];
