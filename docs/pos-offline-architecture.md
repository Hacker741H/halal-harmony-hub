# POS Offline First - POS-04A

## Scope delivered

POS-04A creates the durable local foundation for a previously provisioned
cash-register terminal. It deliberately does **not** synchronize an offline
sale to Supabase yet. In particular, it does not alter `wallets`,
`finance_operations`, server-side stock, invoices, payments, permissions, or
the existing online `create_commerce_cash_sale` workflow.

While the terminal is offline, only a cash sale can be recorded locally. It is
not an ERP sale yet: it is a durable local ticket and an outbox event awaiting
the future server protocol of POS-04B.

## Existing behavior retained

The online checkout is unchanged. When the application can contact the POS
backend, it continues to use the existing transactional sale workflow, which
creates the sale, invoice, payment, financial operation, wallet update and
stock movement on the server.

Older browser drafts stored by the prior POS implementation are copied once to
IndexedDB when the current cashier opens the matching point of sale. They are
deleted from legacy local storage only after the IndexedDB copy succeeds.

## IndexedDB database

Database name: `halal-erp-pos-offline` (version 1).

| Store | Purpose |
| --- | --- |
| `pos_terminal` | Stable terminal UUID and the previously authorized points of sale for each user. |
| `pos_catalog` | Minimal authorized catalogue: item ID, SKU/reference, name, unit and selling price. |
| `pos_stock_snapshot` | Server stock baseline and local available stock for the point of sale. |
| `pos_sessions` | Local cash-session identity and state. |
| `pos_tickets` | Active, suspended and locally paid ticket metadata. |
| `pos_ticket_lines` | Ticket lines stored independently from ticket metadata. |
| `pos_suspended_tickets` | References and timestamps for suspended tickets. |
| `pos_outbox` | Durable events that POS-04B will send to the server. |
| `pos_sync_state` | Local connectivity hint and timestamp. |

This is structured data, not a single serialized cashier blob. All records are
scoped by location and authenticated cashier ID.

## Terminal and session identity

On first local use, the terminal creates a browser UUID and stores it in
`pos_terminal`. It is reused across refreshes and browser restarts. Each local
ticket also records its location, cashier, terminal and cash-session IDs.

Prepared local session states are `OPEN`, `CLOSED_LOCAL`, `SYNC_PENDING`, and
`SYNCED`. POS-04A persists `OPEN` sessions used by tickets. The actual cash
closing procedure and server acknowledgement are intentionally postponed until
POS-04B; no misleading local closure action is exposed yet.

## Catalogue and local stock

When a cashier is online at an authorized point of sale, the existing POS
catalogue query populates the local catalogue and stock snapshot. Only fields
needed to sell are stored.

An offline article sale decreases `availableQuantity` locally. A service has
no stock entry and never decreases stock. A later background catalogue refresh
does not overwrite this local deduction: each stock record keeps the last
server quantity and preserves the unsynced local delta. This prevents a
refresh from showing sold units as available again before POS-04B accepts the
event.

The local stock is an operational limit, not the central authority. Two
terminals may still sell the same item while disconnected. During POS-04B, the
server will remain the final authority and may return a conflict without any
financial side effect.

## Tickets, services and suspended work

The active ticket, its article and service lines, customer selection and cash
amount survive refresh, resize and browser restart. Suspending a ticket only
changes local ticket state: it creates no financial operation. Resuming
restores the exact local lines; deleting a suspended ticket only removes that
local draft.

Mixed tickets are supported offline: article lines affect local stock and
service lines do not.

## Offline cash sales and the outbox

For an offline cash sale, the browser writes atomically to IndexedDB:

1. the paid-local ticket and lines;
2. one `CREATE_CASH_SALE` outbox event with a UUID created before any future
   request;
3. local stock decrements for article lines only;
4. a fresh active ticket.

Outbox states are `PENDING`, `SYNCING`, `SYNCED`, `FAILED`, and `CONFLICT`.
Events are retained until a reliable server acknowledgement marks them
`SYNCED`. Future retries use deterministic chronological order and the same
event ID, so the event cannot create a second local stock decrement.

POS-04B must submit that stable ID to a dedicated transactional server entry
point. That entry point must delegate to the existing POS financial workflow;
the browser must never insert directly into `finance_operations` or update a
wallet.

## Connectivity UX

`navigator.onLine` is only a UI hint. The POS also records real checkout
network failures as an offline hint. The cashier sees a simple online/offline
state and the number of locally pending cash sales. POS-04A does not expose a
manual synchronization button and does not automatically post queued sales.

Mobile payments (Jeko, Wave, card) remain unavailable offline. A cashier
cannot manually claim that a mobile payment succeeded.

## Security

No password, service role, API key, webhook secret, access token or
authorization value may be written to the POS local stores. The implementation
rejects sensitive field names before persisting an outbox payload. IndexedDB is
only a working cache on a previously authenticated and provisioned terminal;
it does not bypass authentication or server permissions.

All definitive audit timestamps, stock authority, payment confirmation,
financial operations and wallet balances remain server-controlled.

## PWA status

The application already registers a service worker for the application shell.
POS-04A does not cache Supabase/API responses and does not claim that first
launch without a connection is supported. Offline opening requires a terminal
that has already loaded the app and its allowed POS data while online. A
separate PWA cache audit is required before promising full cold-start offline
support on every browser.

## Local verification

`scripts/test-commerce-pos-offline.ts` uses an IndexedDB emulator and covers:

- stable terminal identity;
- cached point of sale and catalogue;
- article plus service ticket;
- suspended/resumed/deleted tickets;
- one durable cash outbox event;
- retry with the same event ID and no double stock decrement;
- catalogue refresh preserving a pending local deduction;
- deterministic retry order;
- sensitive-data rejection.

## POS-04B prerequisites and limits

POS-04B must define, test and secure the server-side synchronization contract:

- a transactionally idempotent endpoint/RPC for each stable outbox event;
- authoritative stock reconciliation and conflict status;
- server receipt and audit timestamps;
- automatic retry/backoff and one-terminal synchronization locking;
- session close acknowledgement;
- safe recovery after an unknown HTTP outcome.

Until that work exists, queued offline cash sales remain local and no wallet,
invoice, payment, stock or financial journal is changed remotely.
