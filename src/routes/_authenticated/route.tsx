import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedRoute,
});

function AuthenticatedRoute() {
  const navigate = useNavigate();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

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

  if (isCheckingSession) return null;

  return <Outlet />;
}
