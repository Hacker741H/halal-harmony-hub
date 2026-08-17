/**
 * Pure decision points extracted from the authenticated route's session
 * bootstrap (see src/routes/_authenticated/route.tsx) so they can be unit
 * tested without a browser/DOM. Behavior is unchanged from the inline
 * version this replaced -- only the two branch conditions moved here.
 */

export type SessionCheckResult = "REDIRECT_TO_AUTH" | "RENDER_AND_VERIFY";

export function resolveSessionCheck(hasLocalSession: boolean): SessionCheckResult {
  return hasLocalSession ? "RENDER_AND_VERIFY" : "REDIRECT_TO_AUTH";
}

export type BackgroundVerificationResult = "OK" | "REDIRECT_TO_AUTH";

export function resolveBackgroundVerification(user: unknown, error: unknown): BackgroundVerificationResult {
  return error || !user ? "REDIRECT_TO_AUTH" : "OK";
}
