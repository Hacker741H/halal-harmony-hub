import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { ReportingCenter, type ReportsSearch } from "@/components/reports/reporting-center";
import { REPORT_TYPES, reportFiltersSchema } from "@/lib/reporting.functions";

const reportsSearchSchema = z
  .object({
    tab: z.enum(REPORT_TYPES).optional(),
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
    walletId: z.string().uuid().optional(),
    operationType: z.enum(["REVENUE", "EXPENSE", "DEPOSIT", "TRANSFER"]).optional(),
    category: z.string().trim().min(1).max(120).optional(),
    status: z.string().trim().min(1).max(80).optional(),
    driverId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    motorcycleId: z.string().uuid().optional(),
    farmId: z.string().uuid().optional(),
    inventoryItemId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const { tab: _tab, ...filters } = value;
    const result = reportFiltersSchema.safeParse(filters);
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue(issue);
    }
  });

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Rapports — HALAL ERP" }] }),
  validateSearch: reportsSearchSchema,
  component: ReportsPage,
});

function ReportsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <ReportingCenter
      search={search}
      onSearchChange={(nextSearch: ReportsSearch) => {
        void navigate({ search: nextSearch });
      }}
    />
  );
}
