// GFC V1 Phase 6, section 12A -- targeted automated tests for the auth
// bootstrap decision logic (Phase 5.5's fix to _authenticated/route.tsx,
// plus the sibling event-filtering logic in __root.tsx's useSession()).
// These exercise the pure functions the components delegate to, extracted
// without changing behavior specifically so this suite could exist.
//
// Scenario 6 ("logout -> auth") has no unit test here on purpose: it is
// `await supabase.auth.signOut(); navigate({ to: "/auth" })` in
// __root.tsx's AuthenticatedShell -- a straight-line imperative call with
// no branch to assert on, not a decision function. Verified by reading
// that code, not by a test double standing in for a real Supabase client.
import assert from "node:assert/strict";

import { AuthRetryableFetchError } from "@supabase/supabase-js";

import { resolveBackgroundVerification, resolveSessionCheck } from "../src/lib/auth-bootstrap";
import { isRelevantAuthEvent, shouldSkipFullSessionResync } from "../src/lib/auth-session-resync";

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function run(): void {
  // 1. No local session -> auth.
  expect(
    resolveSessionCheck(false) === "REDIRECT_TO_AUTH",
    "A hard load with no local session must redirect to /auth.",
  );

  // 2. Local session present -> the protected route can start rendering.
  expect(
    resolveSessionCheck(true) === "RENDER_AND_VERIFY",
    "A locally present session must unblock rendering immediately.",
  );

  // 3. Background server validation fails after render already started ->
  // the session is treated as invalid and the user is sent to /auth.
  expect(
    resolveBackgroundVerification(null, new Error("expired")) === "REDIRECT_TO_AUTH",
    "A getUser() error must invalidate the session even after first paint.",
  );
  expect(
    resolveBackgroundVerification(null, null) === "REDIRECT_TO_AUTH",
    "No error but also no user must still be treated as invalid, not as success.",
  );
  expect(
    resolveBackgroundVerification({ id: "user-1" }, null) === "OK",
    "A real user with no error must be accepted.",
  );
  // 3b. A transient network failure during the background check is not the
  // same signal as "this token is invalid" -- getSession() already found a
  // local session before this check ever ran. Bouncing the user to /auth
  // over a dropped request, not an actual rejection, would be a false
  // logout indistinguishable to them from a real one.
  expect(
    resolveBackgroundVerification(null, new AuthRetryableFetchError("fetch failed", 0)) === "OK",
    "A transient network error from getUser() must not force a logout.",
  );

  // 4. TOKEN_REFRESHED (same user, by construction -- a token refresh can't
  // change identity) must never trigger a global cache purge / router
  // invalidation. It is filtered out before shouldSkipFullSessionResync is
  // even reached.
  expect(
    isRelevantAuthEvent("TOKEN_REFRESHED") === false,
    "TOKEN_REFRESHED must be filtered out, never treated as a resync candidate.",
  );
  // supabase-js's own re-emission of SIGNED_IN for an already-connected user
  // (e.g. on tab-visibility-return) must be recognized as the same case and
  // skipped too, so it doesn't unmount the authenticated shell.
  expect(
    shouldSkipFullSessionResync("SIGNED_IN", "user-1", "user-1") === true,
    "A same-user SIGNED_IN re-emission must skip the full resync.",
  );

  // 5. A real account change must still invalidate caches exactly as today.
  expect(
    isRelevantAuthEvent("SIGNED_IN") === true,
    "SIGNED_IN must remain a resync candidate.",
  );
  expect(
    shouldSkipFullSessionResync("SIGNED_IN", "user-1", "user-2") === false,
    "A genuine identity change must never be skipped -- caches must be purged.",
  );
  expect(
    shouldSkipFullSessionResync("SIGNED_IN", null, "user-1") === false,
    "The very first sign-in (no previous user) must not be treated as a same-user re-emission.",
  );

  console.log("Auth bootstrap tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
