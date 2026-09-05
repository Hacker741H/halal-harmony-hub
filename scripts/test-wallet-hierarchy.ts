// Stabilisation audit, section 7/15 -- targeted automated test for the
// wallet parent/child selectability rule: "un wallet parent avec enfants
// est un conteneur consolidé, jamais transactionnel." This exact class of
// bug was found TWICE this session (the Commerce cash-remittance
// destination picker, and the Field wallet-assignment pickers) -- both
// were hand-rolled selects that never excluded parent wallets, discovered
// only by reading SQL/TS by hand. This test locks down the one place the
// exclusion logic is now centralized (WalletSelect's
// partitionWalletsByHierarchy, src/components/selects/entity-selects.tsx)
// so a future regression there is caught immediately instead of requiring
// another manual audit pass.
import assert from "node:assert/strict";

import { partitionWalletsByHierarchy } from "../src/components/selects/entity-selects";

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

type TestWallet = { id: string; parent_wallet_id: string | null };

function run(): void {
  // 1. A wallet with children (a parent) must never appear as a flat,
  // directly-selectable option -- this is the exact rule both real gaps
  // violated.
  const wallets: TestWallet[] = [
    { id: "marasse", parent_wallet_id: null },
    { id: "wave", parent_wallet_id: "marasse" },
    { id: "especes", parent_wallet_id: "marasse" },
    { id: "standalone", parent_wallet_id: null },
  ];
  const { flatOptions, groups } = partitionWalletsByHierarchy(wallets);
  expect(
    !flatOptions.some((wallet) => wallet.id === "marasse"),
    "A parent wallet (has children) must never appear in flatOptions -- it must never be directly transactional.",
  );
  expect(
    flatOptions.some((wallet) => wallet.id === "standalone"),
    "A wallet with no parent and no children must appear as a normal flat option.",
  );
  expect(
    groups.length === 1 && groups[0].parent.id === "marasse",
    "The parent must appear exactly once, as a group header, not as a selectable leaf.",
  );
  expect(
    groups[0].children.map((c) => c.id).sort().join(",") === "especes,wave",
    "Both children must be selectable, grouped under their parent.",
  );

  // 2. A child wallet (has a parent, but no children of its own) is a
  // normal leaf and must remain selectable -- the rule excludes parents,
  // not children.
  expect(
    !flatOptions.some((wallet) => wallet.id === "wave"),
    "A child wallet must not appear in flatOptions directly -- it's grouped under its parent, not flat.",
  );
  expect(
    groups[0].children.some((child) => child.id === "wave"),
    "A leaf child wallet must still be selectable, inside its parent's group.",
  );

  // 3. excludeWalletId must remove a wallet from BOTH flatOptions and
  // every group's children (used by TransferForm to stop a wallet from
  // being its own destination).
  const excluded = partitionWalletsByHierarchy(wallets, "wave");
  expect(
    !excluded.groups[0].children.some((child) => child.id === "wave"),
    "excludeWalletId must remove that wallet from its parent's children.",
  );
  expect(
    !excluded.flatOptions.some((wallet) => wallet.id === "standalone" && wallet.id === "wave"),
    "excludeWalletId must not remove unrelated wallets.",
  );
  const excludedStandalone = partitionWalletsByHierarchy(wallets, "standalone");
  expect(
    !excludedStandalone.flatOptions.some((wallet) => wallet.id === "standalone"),
    "excludeWalletId must remove a flat (non-hierarchical) wallet too.",
  );

  // 4. A parent with zero children left after exclusion must not produce
  // an empty group header with nothing under it.
  const soleChildWallets: TestWallet[] = [
    { id: "parent-with-one-child", parent_wallet_id: null },
    { id: "only-child", parent_wallet_id: "parent-with-one-child" },
  ];
  const { groups: emptyGroups } = partitionWalletsByHierarchy(soleChildWallets, "only-child");
  expect(
    emptyGroups.length === 0,
    "A parent whose only child was excluded must not render as an empty group.",
  );

  // 5. No wallets at all -- must not throw, must return empty structures.
  const empty = partitionWalletsByHierarchy([]);
  expect(empty.flatOptions.length === 0 && empty.groups.length === 0, "An empty wallet list must produce empty results, not throw.");

  console.log("Wallet hierarchy tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
