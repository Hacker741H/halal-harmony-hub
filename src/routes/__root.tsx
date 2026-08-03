import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { ProductHeader } from "@/components/shell/product-header";
import { ShellPreferencesProvider, useShellPreferences } from "@/components/shell/shell-preferences";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { PwaRegistration } from "@/components/pwa/pwa-registration";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page introuvable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          La page que vous recherchez n'existe pas.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Une erreur est survenue</h1>
        <p className="mt-2 text-sm text-muted-foreground">Réessayez ou retournez à l'accueil.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => { router.invalidate(); reset(); }}>Réessayer</Button>
          <Button variant="outline" asChild><a href="/">Accueil</a></Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0d5c3f" },
      { title: "HALAL ERP — Suite de gestion d'entreprise" },
      { name: "description", content: "ERP moderne pour le transport, l'agriculture, les finances et les ressources humaines. Schéma compatible Notion." },
      { property: "og:title", content: "HALAL ERP — Suite de gestion d'entreprise" },
      { property: "og:description", content: "ERP moderne pour le transport, l'agriculture, les finances et les ressources humaines." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/pwa-icon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function useSession() {
  const [session, setSession] = useState<{ email?: string; fullName?: string } | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      // A different user must never inherit cached permissions or data from the
      // previously connected account.
      queryClient.clear();
      if (user) setSession({ email: user.email ?? undefined, fullName: (user.user_metadata as { full_name?: string } | null)?.full_name });
      else setSession(null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      queryClient.clear();
      if (nextSession?.user) {
        setSession({ email: nextSession.user.email ?? undefined, fullName: (nextSession.user.user_metadata as { full_name?: string } | null)?.full_name });
      } else {
        setSession(null);
      }
      router.invalidate();
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient, router]);
  return session;
}

function AuthenticatedShell() {
  const session = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const { sidebarWidth, density } = useShellPreferences();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": sidebarWidth === "compact" ? "14rem" : "17rem",
        } as CSSProperties
      }
    >
      <div className="flex min-h-screen w-full bg-canvas" data-density={density}>
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col pb-3 md:pb-4">
          <ProductHeader user={session} onSignOut={signOut} />
          <main className="flex-1 overflow-x-hidden pt-3 md:pt-4">
            <div key={pathname} className="animate-fade-in">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const isAuthRoute = pathname.startsWith("/auth");

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ShellPreferencesProvider>
          {isAuthRoute ? <Outlet /> : <AuthenticatedShell />}
          <Toaster />
          <PwaRegistration />
        </ShellPreferencesProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
