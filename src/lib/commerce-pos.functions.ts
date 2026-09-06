import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const callUntypedRpc = (client: { rpc: unknown }, name: string, args: Record<string, unknown>) =>
  (client.rpc as (functionName: string, parameters: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>)(name, args);

const locationSchema = z.object({ id: z.string().uuid(), name: z.string(), code: z.string() });
const walletSchema = z.object({ id: z.string().uuid(), name: z.string(), purpose: z.string(), isPrimary: z.boolean() });
// `category` is nullable AND defaulted (not just nullable): the RPC only
// started returning this key once migration 20260814150000 lands on the
// database this server function talks to. Until that migration is applied,
// the key is simply absent from the RPC's jsonb result, and a `.parse()`
// against a required field would throw and take the whole register down.
const itemSchema = z.object({ id: z.string().uuid(), name: z.string(), sku: z.string().nullable(), unit: z.string().nullable(), category: z.string().nullable().default(null), quantity: z.number(), salePrice: z.number().nullable(), reorderLevel: z.number().nullable() });

const workspaceSchema = z.object({
  location: locationSchema,
  wallets: z.array(walletSchema),
  items: z.array(itemSchema),
  today: z.object({ saleCount: z.number(), received: z.number() }),
});

const commerceManagementDashboardSchema = z.object({
  location: locationSchema,
  financialAccess: z.boolean(),
  today: z.object({ salesCount: z.number(), received: z.number() }).nullable(),
  week: z.object({ salesCount: z.number(), received: z.number() }).nullable(),
  month: z.object({ salesCount: z.number(), received: z.number() }).nullable(),
  cashDrawer: z.object({ id: z.string().uuid(), name: z.string(), balance: z.number() }).nullable(),
  inventory: z.object({ itemsCount: z.number(), lowStockCount: z.number(), outOfStockCount: z.number() }),
  recentSales: z.array(z.object({
    saleNumber: z.string(),
    saleDate: z.string(),
    status: z.string(),
    createdAt: z.string(),
    amount: z.number(),
  })),
});

const storeExpenseCategorySchema = z.enum(["RENT", "ELECTRICITY", "WATER", "INTERNET", "TRANSPORT", "MAINTENANCE", "REPAIR", "SUPPLIES", "SALARY_BONUS", "TAX_FEE", "OTHER"]);
const storeCockpitAccessSchema = z.object({
  financial: z.boolean(),
  stockValuation: z.boolean(),
  expensesRead: z.boolean(),
  expensesCreate: z.boolean(),
  expensesConfirm: z.boolean(),
  cash: z.boolean(),
  stock: z.boolean(),
});
const storeCockpitProfitabilitySchema = z.object({
  from: z.string(),
  to: z.string(),
  isComplete: z.boolean(),
  articleRevenue: z.number(),
  serviceRevenue: z.number(),
  totalRevenue: z.number(),
  costOfGoodsSold: z.number().nullable(),
  grossMargin: z.number().nullable(),
  operatingExpenses: z.number(),
  netResult: z.number().nullable(),
});
export const commerceStoreCockpitSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  access: storeCockpitAccessSchema,
  location: z.object({
    id: z.string().uuid(), name: z.string(), code: z.string(), status: z.string(), address: z.string().nullable(),
    openedAt: z.string(), manager: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    lastActivityAt: z.string().nullable(),
  }),
  wallets: z.array(z.object({ id: z.string().uuid(), name: z.string(), purpose: z.string(), isPrimary: z.boolean(), balance: z.number() })),
  profitability: storeCockpitProfitabilitySchema.nullable(),
  costCertification: z.object({ firstSnapshotAt: z.string().nullable(), selectedPeriodCertified: z.boolean() }).nullable(),
  sales: z.object({
    ticketCount: z.number(), averageBasket: z.number(), cancelledCount: z.number(),
    recent: z.array(z.object({
      id: z.string().uuid(), saleNumber: z.string(), saleDate: z.string(), status: z.string(), reference: z.string().nullable(),
      createdAt: z.string(), total: z.number(), articleLines: z.number(), serviceLines: z.number(),
    })),
    topItems: z.array(z.object({ id: z.string().uuid().nullable(), name: z.string(), quantity: z.number(), revenue: z.number() })),
    services: z.array(z.object({ name: z.string(), quantity: z.number(), revenue: z.number() })),
  }).nullable(),
  stock: z.object({
    isComplete: z.boolean(), itemCount: z.number(), valuedItemCount: z.number(), costValue: z.number().nullable(),
    potentialSaleValue: z.number(), potentialMargin: z.number().nullable(), lowStockCount: z.number(),
    items: z.array(z.object({
      id: z.string().uuid(), sku: z.string().nullable(), name: z.string(), unit: z.string().nullable(), quantity: z.number(),
      unitCost: z.number().nullable(), costValue: z.number().nullable(), salePrice: z.number().nullable(),
      potentialSaleValue: z.number().nullable(), potentialMargin: z.number().nullable(), reorderLevel: z.number().nullable(), isLow: z.boolean(),
    })),
  }).nullable(),
  expenses: z.object({
    rows: z.array(z.object({
      id: z.string().uuid(), category: storeExpenseCategorySchema, amount: z.number(), expenseDate: z.string(), status: z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]),
      description: z.string(), reference: z.string().nullable(), createdAt: z.string(), confirmedAt: z.string().nullable(),
      createdBy: z.string(), confirmedBy: z.string().nullable(), walletId: z.string().uuid().nullable(), walletName: z.string().nullable(),
      operationId: z.string().uuid().nullable(), financeReference: z.string().nullable(),
    })),
    planned: z.array(z.object({
      id: z.string().uuid(), category: storeExpenseCategorySchema, expectedAmount: z.number(), dueDate: z.string(),
      status: z.enum(["PLANNED", "PAID", "CANCELLED"]), reference: z.string().nullable(), description: z.string(),
      paidExpenseId: z.string().uuid().nullable(), createdAt: z.string(), timing: z.enum(["OVERDUE", "UPCOMING", "PAID", "CANCELLED"]),
    })),
  }).nullable(),
  cash: z.object({
    reviewRequiredCount: z.number(), unclosedSessionCount: z.number(),
    closures: z.array(z.object({
      id: z.string().uuid(), cashSessionId: z.string(), terminalId: z.string(), cashier: z.string(), openedAt: z.string(), closedAt: z.string(),
      theoreticalCash: z.number(),
      // Mission caisse: an AUTOMATIC closure (closure_kind='AUTOMATIC', no
      // cashier declaration) never has a physical count to compare against,
      // so counted_cash/server_difference/totals_match are NULL in the
      // database, not merely absent -- nullable, not just optional.
      countedCash: z.number().nullable(), difference: z.number().nullable(), status: z.enum(["SYNCED", "REVIEW_REQUIRED"]), totalsMatch: z.boolean().nullable(),
      // POS-06B: status describes offline-sync completeness only. A session
      // made of online sales can be SYNCED and still have a real cash gap --
      // this is that independent signal.
      requiresCashReview: z.boolean().nullable().optional(),
    })).transform((closures) => closures.map((closure) => ({
      ...closure,
      // null difference means "nothing to compare yet" (AUTOMATIC closure),
      // never "a discrepancy was found" -- must not default to true.
      requiresCashReview: closure.requiresCashReview ?? (closure.difference !== null && closure.difference !== 0),
    }))),
  }).nullable(),
  remittances: z.array(z.object({
    id: z.string().uuid(), date: z.string(), amount: z.number(), status: z.string(), reference: z.string().nullable(), sourceWallet: z.string(), destinationWallet: z.string(),
  })),
  finance: z.object({
    inflows: z.number(), outflows: z.number(), operations: z.array(z.object({
      id: z.string().uuid(), date: z.string(), type: z.string(), amount: z.number(), category: z.string().nullable(), description: z.string().nullable(),
      reference: z.string().nullable(), status: z.string().nullable(), origin: z.string().nullable(), createdAt: z.string(), walletName: z.string().nullable(),
    })),
  }).nullable(),
  sync: z.object({
    processedCount: z.number(), conflictCount: z.number(), pendingCount: z.number().nullable(),
    receipts: z.array(z.object({
      id: z.string().uuid(), offlineSaleId: z.string(), terminalId: z.string(), cashier: z.string(), createdAtDevice: z.string(), receivedAtServer: z.string(),
      status: z.enum(["PROCESSED", "CONFLICT"]), saleId: z.string().uuid().nullable(), errorCode: z.string().nullable(), errorMessage: z.string().nullable(),
    })),
  }).nullable(),
  attention: z.array(z.object({ type: z.string(), id: z.string(), priority: z.number(), date: z.string(), title: z.string(), detail: z.string() })),
  timeline: z.array(z.object({ type: z.string(), id: z.string(), occurredAt: z.string(), title: z.string(), status: z.string().nullable(), detail: z.string().nullable() })),
});

const commerceCashRemittanceWorkspaceSchema = z.object({
  access: z.object({ declare: z.boolean(), confirm: z.boolean() }),
  summary: z.object({
    closedTheoretical: z.number(), closedCounted: z.number(), awaitingConfirmation: z.number(),
    confirmedReceived: z.number(), remainingToRemit: z.number(), cashDifference: z.number(), remittanceDifference: z.number(),
  }),
  closures: z.array(z.object({
    id: z.string().uuid(), cashSessionId: z.string(), closedAt: z.string(), cashierId: z.string().uuid(), cashier: z.string(),
    // Nullable : une clôture pas encore comptée physiquement (parcours
    // automatique, closure_kind='AUTOMATIC') n'a ni compté ni écart --
    // même réalité déjà gérée pour la liste de clôtures du cockpit (voir
    // countedCash plus haut dans ce fichier). Correctif préflight
    // production : remainingAmount était laissé non-nullable en
    // supposant que GREATEST(NULL - x, 0) = 0 suffisait à l'exclure des
    // clôtures remisables -- vérifié faux contre la donnée réelle (0
    // FCFA affiché pour une session jamais comptée, un signal identique
    // à "entièrement remise"). La RPC (20260906130000) renvoie désormais
    // explicitement NULL, jamais 0, quand counted_cash est inconnu.
    theoreticalCash: z.number(), countedCash: z.number().nullable(), cashDifference: z.number().nullable(), status: z.enum(["SYNCED", "REVIEW_REQUIRED"]), remainingAmount: z.number().nullable(),
  })),
  destinationWallets: z.array(z.object({ id: z.string().uuid(), name: z.string(), purpose: z.enum(["COLLECTION", "OPERATING"]) })),
  remittances: z.array(z.object({
    id: z.string().uuid(), eventId: z.string(), status: z.enum(["DECLARED", "CONFIRMED", "CANCELLED"]),
    declaredAt: z.string(), confirmedAt: z.string().nullable(), expectedAmount: z.number(), declaredAmount: z.number(),
    receivedAmount: z.number().nullable(), cashDifference: z.number(), remittanceDifference: z.number().nullable(),
    note: z.string().nullable(), confirmationNote: z.string().nullable(), cashierId: z.string().uuid().nullable(), cashier: z.string(),
    confirmer: z.string().nullable(), sourceWallet: z.string(), destinationWallet: z.string().nullable(),
    closures: z.array(z.object({ id: z.string().uuid(), cashSessionId: z.string(), closedAt: z.string(), allocatedAmount: z.number() })),
  })),
});

const cashRemittanceResultSchema = z.object({
  id: z.string().uuid(), status: z.enum(["DECLARED", "CONFIRMED", "CANCELLED"]),
  expectedAmount: z.number().optional(), declaredAmount: z.number().optional(), receivedAmount: z.number().nullable().optional(),
  operationId: z.string().uuid().optional(),
});

const storeExpenseInputSchema = z.object({
  businessLocationId: z.string().uuid(), category: storeExpenseCategorySchema, amount: z.number().finite().positive(), expenseDate: z.string().date(),
  reference: z.string().trim().max(160).nullable(), description: z.string().trim().min(1).max(1000),
}).strict();
const storePlannedExpenseInputSchema = z.object({
  businessLocationId: z.string().uuid(), category: storeExpenseCategorySchema, expectedAmount: z.number().finite().positive(), dueDate: z.string().date(),
  reference: z.string().trim().max(160).nullable(), description: z.string().trim().min(1).max(1000),
}).strict();
const storeExpenseRecordSchema = z.object({ id: z.string().uuid(), status: z.string() });
const storePlannedExpenseRecordSchema = z.object({ id: z.string().uuid(), status: z.string() });

const articleSaleLineSchema = z.object({
  lineType: z.literal("ARTICLE"),
  inventoryItemId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
}).strict();

const serviceSaleLineSchema = z.object({
  lineType: z.literal("SERVICE"),
  serviceName: z.string().trim().min(1).max(160),
  serviceNote: z.string().trim().max(1000).nullable(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
}).strict();

const saleInputSchema = z.object({
  businessLocationId: z.string().uuid(),
  clientId: z.string().uuid().nullable(),
  paymentMethod: z.enum(["CASH", "WAVE", "JEKO", "CARD", "OTHER"]),
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/),
  reference: z.string().trim().max(120).nullable(),
  notes: z.string().trim().max(1000).nullable(),
  // POS-06: the active till session/terminal, when the local POS storage is
  // available. Null together when IndexedDB is blocked -- online checkout
  // must keep working without a session rather than fabricate one.
  cashSessionId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/).nullable(),
  terminalId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/).nullable(),
  lines: z.array(z.discriminatedUnion("lineType", [articleSaleLineSchema, serviceSaleLineSchema])).min(1).max(100),
}).strict();

const offlineArticleSaleLineSchema = articleSaleLineSchema;
const offlineServiceSaleLineSchema = serviceSaleLineSchema;
const offlineSaleSyncSchema = z.object({
  offlineSaleId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,120}$/),
  terminalId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  cashSessionId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  businessLocationId: z.string().uuid(),
  cashierUserId: z.string().uuid(),
  createdAtDevice: z.string().datetime({ offset: true }),
  payload: z.object({
    ticketId: z.string().trim().min(1).max(160),
    clientId: z.string().uuid().nullable(),
    paymentMethod: z.literal("CASH"),
    total: z.number().finite().positive(),
    cashReceived: z.number().finite().nonnegative().nullable(),
    changeDue: z.number().finite().nonnegative(),
    lines: z.array(z.discriminatedUnion("lineType", [offlineArticleSaleLineSchema, offlineServiceSaleLineSchema])).min(1).max(100),
  }).strict(),
}).strict();

const offlineSaleSyncReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  status: z.enum(["PROCESSED", "CONFLICT"]),
  saleId: z.string().uuid().nullable(),
  saleNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  paymentId: z.string().uuid().nullable(),
  operationId: z.string().uuid().nullable(),
  amount: z.number().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

const offlineCashSessionCloseSchema = z.object({
  cashSessionId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  terminalId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  businessLocationId: z.string().uuid(),
  cashierUserId: z.string().uuid(),
  eventId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  payload: z.object({
    openedAtDevice: z.string().datetime({ offset: true }),
    closedAtDevice: z.string().datetime({ offset: true }),
    ticketCount: z.number().int().nonnegative(),
    articleTotal: z.number().finite().nonnegative(),
    serviceTotal: z.number().finite().nonnegative(),
    cashTotal: z.number().finite().nonnegative(),
    otherPaymentTotal: z.number().finite().nonnegative(),
    theoreticalCash: z.number().finite().nonnegative(),
    countedCash: z.number().finite().nonnegative(),
    difference: z.number().finite(),
    note: z.string().trim().max(1000).nullable(),
  }).strict(),
}).strict();

const offlineCashSessionCloseReceiptSchema = z.object({
  closureId: z.string().uuid().nullable(),
  status: z.enum(["SYNCED", "REVIEW_REQUIRED", "PENDING_SALES"]),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export type CommercePosWorkspace = z.infer<typeof workspaceSchema>;
export type CommerceManagementDashboard = z.infer<typeof commerceManagementDashboardSchema>;
export type CommerceStoreCockpit = z.infer<typeof commerceStoreCockpitSchema>;
export type CommerceCashRemittanceWorkspace = z.infer<typeof commerceCashRemittanceWorkspaceSchema>;
export type StoreExpenseCategory = z.infer<typeof storeExpenseCategorySchema>;
export type CommercePosLocation = z.infer<typeof locationSchema>;
export type CommerceCashSaleInput = z.infer<typeof saleInputSchema>;
export type CommerceOfflineSaleSyncInput = z.infer<typeof offlineSaleSyncSchema>;
export type CommerceOfflineSaleSyncReceipt = z.infer<typeof offlineSaleSyncReceiptSchema>;
export type CommerceOfflineCashSessionCloseInput = z.infer<typeof offlineCashSessionCloseSchema>;
export type CommerceOfflineCashSessionCloseReceipt = z.infer<typeof offlineCashSessionCloseReceiptSchema>;
const setupOptionsSchema = z.object({ wallets: z.array(z.object({ id: z.string().uuid(), name: z.string() })), users: z.array(z.object({ id: z.string().uuid(), name: z.string() })) });
const commerceLocationCodeSchema = z.string().trim().transform((value) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")).pipe(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/));
const setupLocationSchema = z.object({ name: z.string().trim().min(2).max(120), code: commerceLocationCodeSchema, walletId: z.string().uuid(), userId: z.string().uuid().nullable() }).strict();
const updateLocationSchema = z.object({ locationId: z.string().uuid(), name: z.string().trim().min(2).max(120), code: commerceLocationCodeSchema, walletId: z.string().uuid() }).strict();
const commerceAssignmentRoleSchema = z.enum(["CASHIER", "STORE_MANAGER", "STOCK_KEEPER", "SALES_AGENT", "OTHER"]);
const commerceLocationAssignmentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string(),
  username: z.string().nullable(),
  assignmentRole: commerceAssignmentRoleSchema,
  startDate: z.string(),
  notes: z.string().nullable(),
});
const assignCommerceLocationUserSchema = z.object({
  locationId: z.string().uuid(),
  userId: z.string().uuid(),
  assignmentRole: commerceAssignmentRoleSchema,
  notes: z.string().trim().max(500).nullable(),
}).strict();
const catalogueItemSchema = z.object({ id: z.string().uuid(), name: z.string(), sku: z.string().nullable(), unit: z.string().nullable(), globalQuantity: z.number(), locationQuantity: z.number(), availableToAllocate: z.number(), salePrice: z.number().nullable(), reorderLevel: z.number().nullable(), lastUnitCost: z.number().nullable().optional() });
const catalogueInputSchema = z.object({ businessLocationId: z.string().uuid(), inventoryItemId: z.string().uuid(), quantity: z.number().nonnegative(), salePrice: z.number().nonnegative(), reorderLevel: z.number().nonnegative().nullable() }).strict();
const nullableOptionalTextSchema = z.string().trim().max(160).nullable();
const commerceInventoryReceiptSchema = z.object({
  businessLocationId: z.string().uuid(),
  inventoryItemId: z.string().uuid().nullable(),
  name: z.string().trim().max(160).nullable(),
  category: nullableOptionalTextSchema,
  sku: nullableOptionalTextSchema,
  unit: nullableOptionalTextSchema,
  quantity: z.number().finite().positive(),
  purchaseUnitPrice: z.number().finite().positive(),
  salePrice: z.number().finite().nonnegative(),
  walletId: z.string().uuid(),
  supplier: nullableOptionalTextSchema,
  reference: nullableOptionalTextSchema,
  reorderLevel: z.number().finite().nonnegative().nullable(),
  movementDate: z.string().date(),
}).strict().superRefine((value, context) => {
  if (!value.inventoryItemId && !value.name) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "Le nom du nouvel article est obligatoire." });
  }
});
export type CommerceSetupOptions = z.infer<typeof setupOptionsSchema>;
export type CommerceCatalogueItem = z.infer<typeof catalogueItemSchema>;
export type CommerceLocationAssignment = z.infer<typeof commerceLocationAssignmentSchema>;
export type CommerceInventoryReceiptInput = z.infer<typeof commerceInventoryReceiptSchema>;

export const getCommercePosLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommercePosLocation[]> => {
    const { data, error } = await context.supabase.rpc("get_commerce_pos_locations");
    if (error) throw error;
    return z.array(locationSchema).parse(data);
  });

export const getCommercePosWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ locationId: z.string().uuid() }).strict())
  .handler(async ({ context, data }): Promise<CommercePosWorkspace> => {
    const { data: result, error } = await context.supabase.rpc("get_commerce_pos_workspace", { p_location_id: data.locationId });
    if (error) throw error;
    return workspaceSchema.parse(result);
  });

export const getCommerceManagementDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ locationId: z.string().uuid() }).strict())
  .handler(async ({ context, data }): Promise<CommerceManagementDashboard> => {
    const { data: result, error } = await context.supabase.rpc("get_commerce_management_dashboard", { p_location_id: data.locationId });
    if (error) throw error;
    return commerceManagementDashboardSchema.parse(result);
  });

export const getCommerceStoreCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ locationId: z.string().uuid(), from: z.string().date(), to: z.string().date() }).strict())
  .handler(async ({ context, data }): Promise<CommerceStoreCockpit> => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "get_commerce_store_cockpit", {
      p_location_id: data.locationId, p_from: data.from, p_to: data.to,
    });
    if (error) throw error;
    return commerceStoreCockpitSchema.parse(result);
  });

export const getCommerceCashRemittanceWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ locationId: z.string().uuid() }).strict())
  .handler(async ({ context, data }): Promise<CommerceCashRemittanceWorkspace> => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "get_commerce_cash_remittance_workspace", { p_location_id: data.locationId });
    if (error) throw error;
    return commerceCashRemittanceWorkspaceSchema.parse(result);
  });

export const declareCommerceCashRemittance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({
    remittanceEventId: z.string().regex(/^[A-Za-z0-9_-]{8,160}$/), businessLocationId: z.string().uuid(),
    reference: z.string().trim().max(160).nullable(), note: z.string().trim().max(1000).nullable(),
    closures: z.array(z.object({ closureId: z.string().uuid(), amount: z.number().finite().positive() }).strict()).min(1),
  }).strict())
  .handler(async ({ context, data }) => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "declare_commerce_cash_remittance", { p_declaration: {
      remittance_event_id: data.remittanceEventId,
      business_location_id: data.businessLocationId,
      reference: data.reference,
      note: data.note,
      closures: data.closures.map((closure) => ({ closure_id: closure.closureId, amount: closure.amount })),
    } });
    if (error) throw error;
    return cashRemittanceResultSchema.parse(result);
  });

export const confirmCommerceCashRemittance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({
    remittanceId: z.string().uuid(), receivedAmount: z.number().finite().positive(), destinationWalletId: z.string().uuid(),
    note: z.string().trim().max(1000).nullable(),
  }).strict())
  .handler(async ({ context, data }) => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "confirm_commerce_cash_remittance", {
      p_remittance_id: data.remittanceId, p_received_amount: data.receivedAmount,
      p_destination_wallet_id: data.destinationWalletId, p_note: data.note,
    });
    if (error) throw error;
    return cashRemittanceResultSchema.parse(result);
  });

export const createCommerceStoreExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(storeExpenseInputSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "create_commerce_store_expense", { p_expense: {
      business_location_id: data.businessLocationId, category: data.category, amount: data.amount,
      expense_date: data.expenseDate, reference: data.reference, description: data.description,
    } });
    if (error) throw error;
    return storeExpenseRecordSchema.parse(result);
  });

export const confirmCommerceStoreExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ expenseId: z.string().uuid(), walletId: z.string().uuid() }).strict())
  .handler(async ({ context, data }) => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "confirm_commerce_store_expense", { p_expense_id: data.expenseId, p_wallet_id: data.walletId });
    if (error) throw error;
    return storeExpenseRecordSchema.parse(result);
  });

export const cancelCommerceStoreExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ expenseId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).strict())
  .handler(async ({ context, data }) => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "cancel_commerce_store_expense", { p_expense_id: data.expenseId, p_reason: data.reason });
    if (error) throw error;
    return storeExpenseRecordSchema.parse(result);
  });

export const createCommerceStorePlannedExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(storePlannedExpenseInputSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "create_commerce_store_planned_expense", { p_charge: {
      business_location_id: data.businessLocationId, category: data.category, expected_amount: data.expectedAmount,
      due_date: data.dueDate, reference: data.reference, description: data.description,
    } });
    if (error) throw error;
    return storePlannedExpenseRecordSchema.parse(result);
  });

export const payCommerceStorePlannedExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ chargeId: z.string().uuid(), walletId: z.string().uuid() }).strict())
  .handler(async ({ context, data }) => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "pay_commerce_store_planned_expense", { p_charge_id: data.chargeId, p_wallet_id: data.walletId });
    if (error) throw error;
    return storePlannedExpenseRecordSchema.parse(result);
  });

export const cancelCommerceStorePlannedExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ chargeId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).strict())
  .handler(async ({ context, data }) => {
    const { data: result, error } = await callUntypedRpc(context.supabase, "cancel_commerce_store_planned_expense", { p_charge_id: data.chargeId, p_reason: data.reason });
    if (error) throw error;
    return storePlannedExpenseRecordSchema.parse(result);
  });

export const createCommerceCashSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(saleInputSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("create_commerce_cash_sale", {
      p_sale: {
        business_location_id: data.businessLocationId,
        client_id: data.clientId,
        payment_method: data.paymentMethod,
        idempotency_key: data.idempotencyKey,
        reference: data.reference,
        notes: data.notes,
        cash_session_id: data.cashSessionId,
        terminal_id: data.terminalId,
        lines: data.lines.map((line) => line.lineType === "ARTICLE"
          ? { line_type: "ARTICLE", inventory_item_id: line.inventoryItemId, quantity: line.quantity, unit_price: line.unitPrice }
          : { line_type: "SERVICE", service_name: line.serviceName, service_note: line.serviceNote, quantity: line.quantity, unit_price: line.unitPrice }),
      },
    });
    if (error) throw error;
    return z.object({ saleId: z.string().uuid(), saleNumber: z.string(), invoiceNumber: z.string(), paymentId: z.string().uuid(), operationId: z.string().uuid().nullable(), amount: z.number() }).parse(result);
  });

/**
 * POS-04B bridge. The database revalidates the cashier, location, stock and
 * captured cash total, then delegates to the existing cash-sale transaction.
 */
export const syncCommercePosOfflineSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(offlineSaleSyncSchema)
  .handler(async ({ context, data }): Promise<CommerceOfflineSaleSyncReceipt> => {
    const { data: result, error } = await context.supabase.rpc("sync_commerce_pos_offline_sale", {
      p_event: {
        offline_sale_id: data.offlineSaleId,
        terminal_id: data.terminalId,
        cash_session_id: data.cashSessionId,
        business_location_id: data.businessLocationId,
        cashier_user_id: data.cashierUserId,
        created_at_device: data.createdAtDevice,
        payload: {
          ticket_id: data.payload.ticketId,
          client_id: data.payload.clientId,
          payment_method: data.payload.paymentMethod,
          total: data.payload.total,
          cash_received: data.payload.cashReceived,
          change_due: data.payload.changeDue,
          lines: data.payload.lines.map((line) => line.lineType === "ARTICLE"
            ? { line_type: "ARTICLE", inventory_item_id: line.inventoryItemId, quantity: line.quantity, unit_price: line.unitPrice }
            : { line_type: "SERVICE", service_name: line.serviceName, service_note: line.serviceNote, quantity: line.quantity, unit_price: line.unitPrice }),
        },
      },
    });
    if (error) throw error;
    return offlineSaleSyncReceiptSchema.parse(result);
  });

/** POS-04C bridge: stores a physical cash count only after POS-04B receipts exist. */
export const syncCommercePosOfflineCashSessionClose = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(offlineCashSessionCloseSchema)
  .handler(async ({ context, data }): Promise<CommerceOfflineCashSessionCloseReceipt> => {
    const { data: result, error } = await context.supabase.rpc("sync_commerce_pos_cash_session_close", {
      p_event: {
        cash_session_id: data.cashSessionId,
        terminal_id: data.terminalId,
        business_location_id: data.businessLocationId,
        cashier_user_id: data.cashierUserId,
        event_id: data.eventId,
        payload: {
          opened_at_device: data.payload.openedAtDevice,
          closed_at_device: data.payload.closedAtDevice,
          ticket_count: data.payload.ticketCount,
          article_total: data.payload.articleTotal,
          service_total: data.payload.serviceTotal,
          cash_total: data.payload.cashTotal,
          other_payment_total: data.payload.otherPaymentTotal,
          theoretical_cash: data.payload.theoreticalCash,
          counted_cash: data.payload.countedCash,
          difference: data.payload.difference,
          note: data.payload.note,
        },
      },
    });
    if (error) throw error;
    return offlineCashSessionCloseReceiptSchema.parse(result);
  });

// --- Mission caisse : cloture automatique, receptions, centre de controle ---

const closeCommercePosCashSessionSchema = z.object({
  cashSessionId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  terminalId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  businessLocationId: z.string().uuid(),
  cashierUserId: z.string().uuid(),
  eventId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  openedAtDevice: z.string().datetime({ offset: true }),
  closedAtDevice: z.string().datetime({ offset: true }),
}).strict();

const closeCommercePosCashSessionReceiptSchema = z.object({
  closureId: z.string().uuid().nullable(),
  reportId: z.string().uuid().nullable(),
  status: z.enum(["SYNCED", "PENDING_SALES"]),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});
export type CommercePosCloseReceipt = z.infer<typeof closeCommercePosCashSessionReceiptSchema>;

/** New cashier flow (mission caisse): no declared data at all. The server
 * computes the theoretical amounts from actual sales and generates the
 * control report atomically. Never sends counted_cash -- that concept no
 * longer exists on this path. */
export const closeCommercePosCashSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(closeCommercePosCashSessionSchema)
  .handler(async ({ context, data }): Promise<CommercePosCloseReceipt> => {
    const { data: result, error } = await context.supabase.rpc("close_commerce_pos_cash_session", {
      p_event: {
        cash_session_id: data.cashSessionId,
        terminal_id: data.terminalId,
        business_location_id: data.businessLocationId,
        cashier_user_id: data.cashierUserId,
        event_id: data.eventId,
        opened_at_device: data.openedAtDevice,
        closed_at_device: data.closedAtDevice,
      },
    });
    if (error) throw error;
    return closeCommercePosCashSessionReceiptSchema.parse(result);
  });

const commercePosCashSessionPreviewSchema = z.object({
  ticketCount: z.number(),
  articleTotal: z.number(),
  articleQuantityTotal: z.number(),
  serviceTotal: z.number(),
  cashTotal: z.number(),
  mobileMoneyTotal: z.number(),
  otherPaymentTotal: z.number(),
  theoreticalCash: z.number(),
  sales: z.array(z.object({
    id: z.string().uuid(), saleNumber: z.string(), createdAt: z.string(), total: z.number(),
    articleCount: z.number(), serviceCount: z.number(), paymentMethod: z.string().nullable(),
  })),
});
export type CommercePosCashSessionPreview = z.infer<typeof commercePosCashSessionPreviewSchema>;

/** Server-side source of truth for the pre-closure summary: every confirmed
 * sale/payment already reflects here the instant it lands, online or
 * offline-then-synced, since it reads commercial_sales directly -- the same
 * definition close_commerce_pos_cash_session itself uses. Read-only, safe to
 * call as often as needed (each sale, on mount, after every sync). */
export const getCommercePosCashSessionPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({
    cashSessionId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
    terminalId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
    businessLocationId: z.string().uuid(),
  }))
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("get_commerce_pos_cash_session_preview", {
      p_cash_session_id: data.cashSessionId,
      p_terminal_id: data.terminalId,
      p_business_location_id: data.businessLocationId,
    });
    if (error) throw error;
    return commercePosCashSessionPreviewSchema.parse(result);
  });

const confirmCommercePosCashReceptionSchema = z.object({
  reportId: z.string().uuid(),
  receptionEventId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/),
  receivedAmount: z.number().finite().positive(),
  isFinal: z.boolean(),
  note: z.string().trim().max(1000).nullable(),
}).strict();

const confirmCommercePosCashReceptionReceiptSchema = z.object({
  remittanceId: z.string().uuid(),
  operationId: z.string().uuid().nullable(),
  receivedAmount: z.number(),
  outstandingBefore: z.number().optional(),
  isFinal: z.boolean().nullable(),
  difference: z.number().optional(),
});
export type CommercePosCashReceptionReceipt = z.infer<typeof confirmCommercePosCashReceptionReceiptSchema>;

/** Manager-only. Never touched by the cashier. Credits the store's own
 * CASH_DRAWER wallet directly -- one DEPOSIT per reception, idempotent by
 * event id. There is no destination wallet to choose: a POS reception is
 * money physically confirmed present in the store's own drawer, not a
 * transfer to a second wallet. Requires the backend's 5-argument overload
 * (deployed with a temporary 6-argument compatibility wrapper first, then
 * this call ships once that wrapper is confirmed live). */
export const confirmCommercePosCashReception = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(confirmCommercePosCashReceptionSchema)
  .handler(async ({ context, data }): Promise<CommercePosCashReceptionReceipt> => {
    const { data: result, error } = await context.supabase.rpc("confirm_commerce_pos_cash_reception", {
      p_report_id: data.reportId,
      p_reception_event_id: data.receptionEventId,
      p_received_amount: data.receivedAmount,
      p_is_final: data.isFinal,
      p_note: data.note ?? undefined,
    });
    if (error) throw error;
    return confirmCommercePosCashReceptionReceiptSchema.parse(result);
  });

const flagCommercePosControlReportSchema = z.object({
  reportId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export const flagCommercePosControlReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(flagCommercePosControlReportSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("flag_commerce_pos_control_report", {
      p_report_id: data.reportId, p_reason: data.reason,
    });
    if (error) throw error;
    return result;
  });

const controlReportSummarySchema = z.object({
  id: z.string().uuid(), closureId: z.string().uuid(), cashSessionId: z.string(), terminalId: z.string(),
  cashier: z.string(), cashierId: z.string().uuid(), openedAt: z.string(), closedAt: z.string(),
  ticketCount: z.number(), articleRevenue: z.number(), serviceRevenue: z.number(), totalRevenue: z.number(),
  articleQuantityTotal: z.number(), cashExpected: z.number(), mobileMoneyTotal: z.number(), otherPaymentTotal: z.number(),
  receivedTotal: z.number(), remainingAmount: z.number(), isFinalized: z.boolean(), lastReceivedAt: z.string().nullable(),
  syncStatus: z.string(), controlStatus: z.enum(["PENDING_CONTROL", "PARTIALLY_RECEIVED", "RECEIVED", "REVIEW_REQUIRED"]),
  flaggedForReview: z.boolean(), flaggedReason: z.string().nullable(), generatedAt: z.string(),
});
export type CommercePosControlReportSummary = z.infer<typeof controlReportSummarySchema>;

const controlReportsWorkspaceSchema = z.object({
  counts: z.object({ pendingControl: z.number(), partiallyReceived: z.number(), received: z.number(), reviewRequired: z.number() }),
  reports: z.array(controlReportSummarySchema),
});
export type CommercePosControlReportsWorkspace = z.infer<typeof controlReportsWorkspaceSchema>;

export const getCommercePosControlReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({
    locationId: z.string().uuid(), from: z.string(), to: z.string(),
    status: z.enum(["PENDING_CONTROL", "PARTIALLY_RECEIVED", "RECEIVED", "REVIEW_REQUIRED"]).nullable(),
    cashierId: z.string().uuid().nullable(),
  }))
  .handler(async ({ context, data }): Promise<CommercePosControlReportsWorkspace> => {
    const { data: result, error } = await context.supabase.rpc("get_commerce_pos_control_reports", {
      p_location_id: data.locationId, p_from: data.from, p_to: data.to, p_status: data.status ?? undefined, p_cashier_id: data.cashierId ?? undefined,
    });
    if (error) throw error;
    return controlReportsWorkspaceSchema.parse(result);
  });

const controlReportDetailSchema = z.object({
  report: controlReportSummarySchema.omit({ cashierId: true, controlStatus: true, receivedTotal: true, remainingAmount: true, isFinalized: true, lastReceivedAt: true }).extend({
    businessLocationId: z.string().uuid(), receivedTotal: z.number(), isFinalized: z.boolean(), remainingAmount: z.number(),
  }),
  sales: z.array(z.object({ id: z.string().uuid(), saleNumber: z.string(), createdAt: z.string(), total: z.number() })),
  receptions: z.array(z.object({
    id: z.string().uuid(), receivedAmount: z.number(), expectedAmount: z.number(), difference: z.number(),
    isFinal: z.boolean().nullable(), destinationWallet: z.string().nullable(), confirmedBy: z.string(),
    confirmedAt: z.string(), note: z.string().nullable(), operationId: z.string().uuid().nullable(),
  })),
});
export type CommercePosControlReportDetail = z.infer<typeof controlReportDetailSchema>;

export const getCommercePosControlReportDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ reportId: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<CommercePosControlReportDetail> => {
    const { data: result, error } = await context.supabase.rpc("get_commerce_pos_control_report_detail", { p_report_id: data.reportId });
    if (error) throw error;
    return controlReportDetailSchema.parse(result);
  });

export const getCommerceSetupOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommerceSetupOptions> => {
    const { data, error } = await context.supabase.rpc("get_commerce_setup_options");
    if (error) throw error;
    return setupOptionsSchema.parse(data);
  });

export const setupCommerceLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(setupLocationSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("setup_commerce_location", { p_setup: { name: data.name, code: data.code, wallet_id: data.walletId, user_id: data.userId } });
    if (error) throw error;
    return z.object({ locationId: z.string().uuid(), name: z.string() }).parse(result);
  });

export const updateCommerceLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateLocationSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("update_commerce_location", {
      p_location: {
        location_id: data.locationId,
        name: data.name,
        code: data.code,
        wallet_id: data.walletId,
      },
    });
    if (error) throw error;
    return z.object({ locationId: z.string().uuid(), name: z.string(), code: z.string(), walletId: z.string().uuid().nullable() }).parse(result);
  });

export const getCommerceLocationAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ locationId: z.string().uuid() }).strict())
  .handler(async ({ context, data }): Promise<CommerceLocationAssignment[]> => {
    const { data: result, error } = await context.supabase.rpc("get_commerce_location_assignments", { p_location_id: data.locationId });
    if (error) throw error;
    return z.array(commerceLocationAssignmentSchema).parse(result);
  });

export const assignCommerceLocationUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(assignCommerceLocationUserSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("assign_business_location_user", {
      p_assignment: {
        business_location_id: data.locationId,
        user_id: data.userId,
        assignment_role: data.assignmentRole,
        notes: data.notes,
      },
    });
    if (error) throw error;
    return z.object({ id: z.string().uuid() }).parse(result);
  });

export const endCommerceLocationAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ assignmentId: z.string().uuid() }).strict())
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("end_commerce_location_assignment", { p_assignment_id: data.assignmentId });
    if (error) throw error;
    return z.object({ id: z.string().uuid(), userId: z.string().uuid(), endedAt: z.string() }).parse(result);
  });

export const getCommerceInventoryCatalogue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ locationId: z.string().uuid() }).strict())
  .handler(async ({ context, data }): Promise<CommerceCatalogueItem[]> => {
    const { data: result, error } = await context.supabase.rpc("get_commerce_inventory_catalogue", { p_location_id: data.locationId });
    if (error) throw error;
    return z.array(catalogueItemSchema).parse(result);
  });

export const configureCommerceLocationItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(catalogueInputSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("configure_commerce_location_item", {
      p_item: {
        business_location_id: data.businessLocationId,
        inventory_item_id: data.inventoryItemId,
        quantity: data.quantity,
        sale_price: data.salePrice,
        reorder_level: data.reorderLevel,
      },
    });
    if (error) throw error;
    return z.object({ id: z.string().uuid(), quantity: z.number(), salePrice: z.number() }).parse(result);
  });

export const receiveCommerceInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(commerceInventoryReceiptSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("receive_commerce_inventory_item", {
      p_receipt: {
        business_location_id: data.businessLocationId,
        inventory_item_id: data.inventoryItemId,
        name: data.name,
        category: data.category,
        sku: data.sku,
        unit: data.unit,
        quantity: data.quantity,
        purchase_unit_price: data.purchaseUnitPrice,
        sale_price: data.salePrice,
        wallet_id: data.walletId,
        supplier: data.supplier,
        reference: data.reference,
        reorder_level: data.reorderLevel,
        movement_date: data.movementDate,
      },
    });
    if (error) throw error;
    return z.object({
      inventoryItemId: z.string().uuid(),
      stockMovementId: z.string().uuid(),
      locationInventoryId: z.string().uuid(),
      quantity: z.number(),
      salePrice: z.number(),
    }).parse(result);
  });

// Standalone stock write-off (perte/casse/peremption) -- deliberately the
// mirror-image of a receipt with no price/wallet fields at all: nothing was
// paid, so nothing financial happens (see write_off_commerce_inventory_item).
const commerceInventoryWriteOffSchema = z.object({
  businessLocationId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  quantity: z.number().finite().positive(),
  reason: z.string().trim().min(3).max(500),
}).strict();
export type CommerceInventoryWriteOffInput = z.infer<typeof commerceInventoryWriteOffSchema>;

export const writeOffCommerceInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(commerceInventoryWriteOffSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc("write_off_commerce_inventory_item", {
      p_writeoff: {
        business_location_id: data.businessLocationId,
        inventory_item_id: data.inventoryItemId,
        quantity: data.quantity,
        reason: data.reason,
      },
    });
    if (error) throw error;
    return z.object({
      inventoryItemId: z.string().uuid(),
      stockMovementId: z.string().uuid(),
      locationInventoryId: z.string().uuid(),
      quantity: z.number(),
      reason: z.string(),
    }).parse(result);
  });
