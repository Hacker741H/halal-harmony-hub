import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { commerceStoreCockpitSchema } from "../src/lib/commerce-pos.functions";

/**
 * Cockpit blocker: an AUTOMATIC closure (closure_kind='AUTOMATIC', no
 * cashier declaration, added by the "mission caisse" migration) has
 * counted_cash/server_difference/totals_match NULL in the database -- the
 * RPC returns them as null, never omits the key. commerceStoreCockpitSchema
 * used to require these as non-nullable, so the very first such closure to
 * land in the cockpit's queried window threw a ZodError and the whole
 * cockpit showed "Le cockpit ne peut pas être chargé". This test pins the
 * fix: both closure shapes must parse, and the requiresCashReview fallback
 * must never treat "nothing to compare yet" as "a discrepancy was found".
 */

function closureFixture(overrides: Partial<{
  countedCash: number | null;
  difference: number | null;
  totalsMatch: boolean | null;
  requiresCashReview: boolean | null | undefined;
}>) {
  return {
    id: randomUUID(), cashSessionId: "cash-session-test", terminalId: "terminal-test", cashier: "Testeur",
    openedAt: "2026-08-16T08:00:00Z", closedAt: "2026-08-16T18:00:00Z",
    theoreticalCash: 2800, status: "SYNCED" as const,
    countedCash: null, difference: null, totalsMatch: null, requiresCashReview: undefined,
    ...overrides,
  };
}

function cockpitPayload(closures: ReturnType<typeof closureFixture>[]) {
  return {
    period: { from: "2026-08-01", to: "2026-08-16" },
    access: { financial: true, stockValuation: true, expensesRead: true, expensesCreate: true, expensesConfirm: true, cash: true, stock: true },
    location: {
      id: randomUUID(), name: "Test", code: "TEST", status: "ACTIVE", address: null,
      openedAt: "2026-08-01", manager: null, lastActivityAt: null,
    },
    wallets: [],
    profitability: null,
    costCertification: null,
    sales: null,
    stock: null,
    expenses: null,
    cash: { reviewRequiredCount: 0, unclosedSessionCount: 0, closures },
    remittances: [],
    finance: null,
    sync: null,
    attention: [],
    timeline: [],
  };
}

function run() {
  // 1. Old DECLARED-style closure, every field populated -- must keep
  // parsing exactly as before (no regression on the pre-existing shape).
  {
    const declared = closureFixture({ countedCash: 2750, difference: -50, totalsMatch: false, requiresCashReview: undefined });
    const result = commerceStoreCockpitSchema.parse(cockpitPayload([declared]));
    const closure = result.cash!.closures[0];
    assert.equal(closure.countedCash, 2750, "DECLARED closure must keep its counted_cash");
    assert.equal(closure.difference, -50, "DECLARED closure must keep its difference");
    assert.equal(closure.totalsMatch, false, "DECLARED closure must keep its totalsMatch");
    assert.equal(closure.requiresCashReview, true, "DECLARED closure with a non-zero difference must require review");
  }

  // 2. New AUTOMATIC closure, all 4 previously-non-nullable fields NULL --
  // this is exactly the real production payload that used to throw.
  {
    const automatic = closureFixture({ countedCash: null, difference: null, totalsMatch: null, requiresCashReview: null });
    assert.doesNotThrow(
      () => commerceStoreCockpitSchema.parse(cockpitPayload([automatic])),
      "an AUTOMATIC closure (all 4 fields null) must parse without throwing",
    );
  }

  // 3. difference = null -> requiresCashReview must be false ("nothing to
  // compare yet"), never true.
  {
    const automatic = closureFixture({ countedCash: null, difference: null, totalsMatch: null, requiresCashReview: undefined });
    const result = commerceStoreCockpitSchema.parse(cockpitPayload([automatic]));
    assert.equal(result.cash!.closures[0].requiresCashReview, false, "difference=null must resolve to requiresCashReview=false");
  }

  // 4. difference = -100 -> requiresCashReview must be true (real shortfall).
  {
    const declared = closureFixture({ countedCash: 2700, difference: -100, totalsMatch: false, requiresCashReview: undefined });
    const result = commerceStoreCockpitSchema.parse(cockpitPayload([declared]));
    assert.equal(result.cash!.closures[0].requiresCashReview, true, "difference=-100 must resolve to requiresCashReview=true");
  }

  // 5. difference = +100 -> requiresCashReview must be true (real overage).
  {
    const declared = closureFixture({ countedCash: 2900, difference: 100, totalsMatch: false, requiresCashReview: undefined });
    const result = commerceStoreCockpitSchema.parse(cockpitPayload([declared]));
    assert.equal(result.cash!.closures[0].requiresCashReview, true, "difference=+100 must resolve to requiresCashReview=true");
  }

  console.log(JSON.stringify({ passed: "COCKPIT_CASH_CLOSURES_SCHEMA_TEST_PASSED", cases: 5 }));
}

run();
