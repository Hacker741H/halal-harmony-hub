import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const locationSchema = z.object({ id: z.string().uuid(), name: z.string(), code: z.string() });
const walletSchema = z.object({ id: z.string().uuid(), name: z.string(), purpose: z.string(), isPrimary: z.boolean() });
const itemSchema = z.object({ id: z.string().uuid(), name: z.string(), sku: z.string().nullable(), unit: z.string().nullable(), quantity: z.number(), salePrice: z.number().nullable(), reorderLevel: z.number().nullable() });

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

export type CommercePosWorkspace = z.infer<typeof workspaceSchema>;
export type CommerceManagementDashboard = z.infer<typeof commerceManagementDashboardSchema>;
export type CommercePosLocation = z.infer<typeof locationSchema>;
export type CommerceCashSaleInput = z.infer<typeof saleInputSchema>;
export type CommerceOfflineSaleSyncInput = z.infer<typeof offlineSaleSyncSchema>;
export type CommerceOfflineSaleSyncReceipt = z.infer<typeof offlineSaleSyncReceiptSchema>;
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
const catalogueItemSchema = z.object({ id: z.string().uuid(), name: z.string(), sku: z.string().nullable(), unit: z.string().nullable(), globalQuantity: z.number(), locationQuantity: z.number(), availableToAllocate: z.number(), salePrice: z.number().nullable(), reorderLevel: z.number().nullable() });
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
        lines: data.lines.map((line) => line.lineType === "ARTICLE"
          ? { line_type: "ARTICLE", inventory_item_id: line.inventoryItemId, quantity: line.quantity, unit_price: line.unitPrice }
          : { line_type: "SERVICE", service_name: line.serviceName, service_note: line.serviceNote, quantity: line.quantity, unit_price: line.unitPrice }),
      },
    });
    if (error) throw error;
    return z.object({ saleId: z.string().uuid(), saleNumber: z.string(), invoiceNumber: z.string(), paymentId: z.string().uuid(), operationId: z.string().uuid(), amount: z.number() }).parse(result);
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
