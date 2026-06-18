import { normalizeAdminAppRow } from "../utils/adminApps";

/** Raw rows for Admin Apps demo mode only (never sent to the server). */
const RAW_PLACEHOLDER_APPS = [
  {
    id: "demo-1001",
    name: "Payments hub",
    slug: "payments-hub",
    description: "Sample published app using an internal SPA route (demo data).",
    category: "FINANCE",
    status: "PUBLISHED",
    visibility: "PUBLIC",
    featured: true,
    routePath: "/all-apps",
    externalUrl: "",
    version: "1.2.0",
    downloads: 120,
    activeUsers: 42,
    createdAt: "2025-01-10T10:00:00.000Z",
    updatedAt: "2025-03-02T14:30:00.000Z",
  },
  {
    id: "demo-1002",
    name: "Partner portal",
    slug: "partner-portal",
    description: "Sample draft with external URL only (demo data).",
    category: "PARTNER",
    status: "DRAFT",
    visibility: "PUBLIC",
    featured: false,
    routePath: "",
    externalUrl: "https://example.com/partner",
    version: "0.9.0",
    downloads: 0,
    activeUsers: 0,
    createdAt: "2025-02-01T09:00:00.000Z",
    updatedAt: "2025-02-28T11:00:00.000Z",
  },
  {
    id: "demo-1003",
    name: "Internal tools",
    slug: "internal-tools",
    description: "Sample PRIVATE app for subscribed users (demo data).",
    category: "INTERNAL",
    status: "PUBLISHED",
    visibility: "PRIVATE",
    featured: false,
    routePath: "/dashboard",
    externalUrl: "",
    version: "2.0.0",
    downloads: 55,
    activeUsers: 18,
    createdAt: "2024-12-15T08:00:00.000Z",
    updatedAt: "2025-01-20T16:45:00.000Z",
  },
];

export function getAdminAppsPlaceholderRows() {
  return RAW_PLACEHOLDER_APPS.map((r) => normalizeAdminAppRow(r)).filter(Boolean);
}
