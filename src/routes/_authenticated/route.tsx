import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCurrentUserAccess } from "@/hooks/use-current-user-access";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedRoute,
});

function AuthenticatedRoute() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const access = useCurrentUserAccess(!isCheckingSession);

  useEffect(() => {
    let isCurrent = true;

    // getSession() reads the client's own already-restored local state and,
    // per supabase-js's contract, waits for that restoration (from storage)
    // to finish before resolving -- unlike getUser(), it can't lose a race
    // against it on a fresh hard load / deep-link / tab reopen. A locally
    // present session is enough to unblock rendering immediately; genuine
    // validity is still enforced on every real data call by the server
    // (requireSupabaseAuth), and double-checked here via a non-blocking
    // background getUser() call so a truly invalid/expired token still
    // redirects -- just without holding up first paint on that slower,
    // network-dependent verification.
    void supabase.auth.getSession().then(({ data }) => {
      if (!isCurrent) return;

      if (!data.session) {
        void navigate({ to: "/auth", replace: true });
        return;
      }

      setIsCheckingSession(false);

      void supabase.auth.getUser().then(({ data: userData, error }) => {
        if (!isCurrent) return;
        if (error || !userData.user) {
          void navigate({ to: "/auth", replace: true });
        }
      });
    });

    return () => {
      isCurrent = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (access.isCashierOnly && !pathname.startsWith("/commerce")) {
      void navigate({ to: "/commerce", replace: true });
    }
  }, [access.isCashierOnly, navigate, pathname]);

  if (isCheckingSession || access.isPending) return null;

  if (access.isCashierOnly && !pathname.startsWith("/commerce")) return null;

  return <Outlet />;
}
