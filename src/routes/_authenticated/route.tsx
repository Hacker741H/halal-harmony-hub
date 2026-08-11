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

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!isCurrent) return;

      if (error || !data.user) {
        void navigate({ to: "/auth", replace: true });
        return;
      }

      setIsCheckingSession(false);
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
