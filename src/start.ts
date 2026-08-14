import { createCsrfMiddleware, createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Scoped to server-function RPC calls only (handlerType === "serverFn"), so
// normal page navigation/SSR is never subject to the same-origin check --
// only same-origin fetches from our own client are allowed to invoke a
// server function. This is additive to, not a replacement for, the Bearer
// token required by requireSupabaseAuth: a forged cross-site request would
// already lack a valid Authorization header, but browsers still attach
// cookies automatically, so this closes the gap for any request path that
// doesn't require a bearer token.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
