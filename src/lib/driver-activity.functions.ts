import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";

const driverActivitySchema = z
  .object({
    driverId: z.string().uuid(),
    from: z.string().date(),
    to: z.string().date(),
  })
  .strict()
  .refine(({ from, to }) => from <= to, {
    message: "La date de début doit précéder ou être égale à la date de fin.",
    path: ["to"],
  });

const expenseCategories = [
  "FUEL",
  "ROAD",
  "MEALS",
  "MISC",
  "EXCEPTIONAL_MAINTENANCE",
] as const;

export type DriverActivityExpenseCategory = (typeof expenseCategories)[number];

export const DRIVER_ACTIVITY_EXPENSE_LABELS: Record<DriverActivityExpenseCategory, string> = {
  FUEL: "Carburant",
  ROAD: "Route et péages",
  MEALS: "Repas",
  MISC: "Divers",
  EXCEPTIONAL_MAINTENANCE: "Maintenance exceptionnelle",
};

type ActivityCourseRow = Pick<
  Tables<"transport_missions">,
  | "id"
  | "mission_number"
  | "status"
  | "departure_location"
  | "destination_location"
  | "actual_departure_at"
  | "planned_departure_at"
  | "vehicle_id"
  | "created_at"
>;

export type DriverActivityCourse = ActivityCourseRow & {
  activityDate: string;
  walletNames: string[];
  collectedAmount: number | null;
  expenseAmount: number | null;
  netAmount: number | null;
};

export type DriverActivitySummary = {
  period: { from: string; to: string };
  courses: DriverActivityCourse[];
  activity: {
    coursesCount: number;
  };
  financial: {
    collectedAmount: number;
    expenseAmount: number;
    netAmount: number;
    expensesByCategory: Record<DriverActivityExpenseCategory, number>;
  } | null;
  salary: {
    paidAmount: number;
    paymentCount: number;
  } | null;
};

export const getDriverActivitySummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(driverActivitySchema)
  .handler(async ({ context, data }): Promise<DriverActivitySummary> => {
    const permissions = new Set(await getPermissionCodesForClient(context.supabase));
    if (!permissions.has("drivers.read") || !permissions.has("missions.read")) {
      throw new Error("Vous n’avez pas la permission de consulter l’activité de ce chauffeur.");
    }

    const { data: courses, error: coursesError } = await context.supabase
      .from("transport_missions")
      .select(
        "id, mission_number, status, departure_location, destination_location, actual_departure_at, planned_departure_at, vehicle_id, created_at",
      )
      .eq("driver_id", data.driverId)
      .neq("status", "CANCELLED")
      .order("created_at", { ascending: false });

    if (coursesError) throw coursesError;

    const driverCourses = (courses ?? []) as ActivityCourseRow[];
    const courseIds = driverCourses.map((course) => course.id);
    const canReadFinance = permissions.has("missions.finance.read");
    const canReadSalaries = permissions.has("salaries.read");

    const [expensesResult, paymentsResult, salariesResult] = await Promise.all([
      canReadFinance && courseIds.length > 0
        ? context.supabase
            .from("transport_mission_expenses")
            .select("mission_id, category, amount, wallet_id")
            .in("mission_id", courseIds)
            .eq("status", "PAID")
            .gte("expense_date", data.from)
            .lte("expense_date", data.to)
        : Promise.resolve({ data: [], error: null }),
      canReadFinance && courseIds.length > 0
        ? context.supabase
            .from("transport_invoice_payments")
            .select("mission_id, amount, wallet_id")
            .in("mission_id", courseIds)
            .eq("status", "CONFIRMED")
            .gte("payment_date", data.from)
            .lte("payment_date", data.to)
        : Promise.resolve({ data: [], error: null }),
      canReadSalaries
        ? context.supabase
            .from("salary_payments")
            .select("amount")
            .eq("driver_id", data.driverId)
            .neq("status", "CANCELLED")
            .gte("paid_at", data.from)
            .lte("paid_at", data.to)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const result of [expensesResult, paymentsResult, salariesResult]) {
      if (result.error) throw result.error;
    }

    const selectedCourseIds = new Set(
      driverCourses
        .filter((course) => isDateInRange(getCourseActivityDate(course), data.from, data.to))
        .map((course) => course.id),
    );
    const expenseByCourse = new Map<string, number>();
    const paymentByCourse = new Map<string, number>();
    const walletIdsByCourse = new Map<string, Set<string>>();
    const expensesByCategory = emptyCategoryTotals();

    for (const expense of expensesResult.data ?? []) {
      const amount = Number(expense.amount);
      selectedCourseIds.add(expense.mission_id);
      expenseByCourse.set(expense.mission_id, (expenseByCourse.get(expense.mission_id) ?? 0) + amount);
      addCourseWallet(walletIdsByCourse, expense.mission_id, expense.wallet_id);
      if (isExpenseCategory(expense.category)) {
        expensesByCategory[expense.category] += amount;
      }
    }

    for (const payment of paymentsResult.data ?? []) {
      const amount = Number(payment.amount);
      selectedCourseIds.add(payment.mission_id);
      paymentByCourse.set(payment.mission_id, (paymentByCourse.get(payment.mission_id) ?? 0) + amount);
      addCourseWallet(walletIdsByCourse, payment.mission_id, payment.wallet_id);
    }

    const walletIds = [...new Set([...walletIdsByCourse.values()].flatMap((ids) => [...ids]))];
    const walletNamesById = new Map<string, string>();
    if (walletIds.length > 0) {
      const { data: wallets, error: walletsError } = await context.supabase
        .from("wallets")
        .select("id, name")
        .in("id", walletIds);
      if (walletsError) throw walletsError;
      for (const wallet of wallets ?? []) {
        walletNamesById.set(wallet.id, wallet.name);
      }
    }

    const activityCourses: DriverActivityCourse[] = driverCourses
      .filter((course) => selectedCourseIds.has(course.id))
      .map((course) => {
        if (!canReadFinance) {
          return {
            ...course,
            activityDate: getCourseActivityDate(course),
            walletNames: [],
            collectedAmount: null,
            expenseAmount: null,
            netAmount: null,
          };
        }

        const collectedAmount = paymentByCourse.get(course.id) ?? 0;
        const expenseAmount = expenseByCourse.get(course.id) ?? 0;
        return {
          ...course,
          activityDate: getCourseActivityDate(course),
          walletNames: [...(walletIdsByCourse.get(course.id) ?? [])]
            .map((walletId) => walletNamesById.get(walletId))
            .filter((walletName): walletName is string => Boolean(walletName)),
          collectedAmount,
          expenseAmount,
          netAmount: collectedAmount - expenseAmount,
        };
      });

    const collectedAmount = [...paymentByCourse.values()].reduce((total, amount) => total + amount, 0);
    const expenseAmount = [...expenseByCourse.values()].reduce((total, amount) => total + amount, 0);
    const paidAmount = (salariesResult.data ?? []).reduce(
      (total, payment) => total + Number(payment.amount),
      0,
    );

    return {
      period: { from: data.from, to: data.to },
      courses: activityCourses,
      activity: { coursesCount: activityCourses.length },
      financial: canReadFinance
        ? { collectedAmount, expenseAmount, netAmount: collectedAmount - expenseAmount, expensesByCategory }
        : null,
      salary: canReadSalaries
        ? { paidAmount, paymentCount: salariesResult.data?.length ?? 0 }
        : null,
    };
  });

function getCourseActivityDate(course: ActivityCourseRow): string {
  return course.actual_departure_at ?? course.planned_departure_at ?? course.created_at;
}

function isDateInRange(value: string, from: string, to: string): boolean {
  const date = value.slice(0, 10);
  return date >= from && date <= to;
}

function addCourseWallet(
  walletIdsByCourse: Map<string, Set<string>>,
  courseId: string,
  walletId: string,
): void {
  const walletIds = walletIdsByCourse.get(courseId) ?? new Set<string>();
  walletIds.add(walletId);
  walletIdsByCourse.set(courseId, walletIds);
}

function emptyCategoryTotals(): Record<DriverActivityExpenseCategory, number> {
  return {
    FUEL: 0,
    ROAD: 0,
    MEALS: 0,
    MISC: 0,
    EXCEPTIONAL_MAINTENANCE: 0,
  };
}

function isExpenseCategory(value: string): value is DriverActivityExpenseCategory {
  return expenseCategories.some((category) => category === value);
}
