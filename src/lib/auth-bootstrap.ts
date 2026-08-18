/**
 * Pure decision points extracted from the authenticated route's session
 * bootstrap (see src/routes/_authenticated/route.tsx) so they can be unit
 * tested without a browser/DOM.
 */

import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export type SessionCheckResult = "REDIRECT_TO_AUTH" | "RENDER_AND_VERIFY";

export function resolveSessionCheck(hasLocalSession: boolean): SessionCheckResult {
  return hasLocalSession ? "RENDER_AND_VERIFY" : "REDIRECT_TO_AUTH";
}

export type BackgroundVerificationResult = "OK" | "REDIRECT_TO_AUTH";

export function resolveBackgroundVerification(user: unknown, error: unknown): BackgroundVerificationResult {
  // getUser() makes a real network call, so its failure mode includes plain
  // connectivity blips -- not just "this token is invalid." supabase-js
  // already tells the two apart via AuthRetryableFetchError (the same class
  // its own getSession() uses internally to avoid discarding a still-valid
  // cached session over a transient refresh failure). Without this check, a
  // dropped request or a slow network could bounce a genuinely logged-in
  // user to /auth for a reason that has nothing to do with their session --
  // and getSession() already confirmed a local session exists before this
  // background check ever runs, so silently deferring is the safe default.
  if (isAuthRetryableFetchError(error)) return "OK";
  return error || !user ? "REDIRECT_TO_AUTH" : "OK";
}
