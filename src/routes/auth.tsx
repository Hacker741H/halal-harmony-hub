import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Leaf, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Connexion — HALAL & CO" }] }),
  component: AuthPage,
});

function usernameToEmail(username: string) {
  const normalized = username.trim().toLowerCase();
  return normalized.includes("@") ? normalized : `${normalized}@halalco.local`;
}

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim()) return toast.error("Saisissez votre nom d’utilisateur.");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    setLoading(false);
    if (error) return toast.error("Identifiant ou mot de passe incorrect.");
    toast.success("Bienvenue dans HALAL & CO.");
    void navigate({ to: "/", replace: true });
  }

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-background px-4 py-6 lg:place-items-center lg:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,color-mix(in_oklch,var(--primary)_26%,transparent),transparent_30rem),radial-gradient(circle_at_86%_84%,color-mix(in_oklch,var(--gold)_28%,transparent),transparent_28rem)]" />
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(var(--ds-canvas-grid)_1px,transparent_1px),linear-gradient(90deg,var(--ds-canvas-grid)_1px,transparent_1px)] [background-size:7rem_7rem]" />

      <section className="relative grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-border/75 bg-surface/85 shadow-lg backdrop-blur-sm lg:grid-cols-[minmax(0,1.1fr)_minmax(25rem,.9fr)]">
        <div className="relative isolate overflow-hidden bg-[linear-gradient(145deg,oklch(0.16_.055_160),oklch(0.28_.08_160)_58%,oklch(0.45_.14_155))] px-6 py-8 text-primary-foreground sm:px-10 sm:py-12 lg:min-h-[39rem] lg:px-12 lg:py-14">
          <img
            src="/halal-welcome-team.jpg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full object-cover object-[50%_40%] opacity-45 saturate-75"
          />
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,oklch(0.12_.045_160/.96),oklch(0.2_.065_160/.82)_58%,oklch(0.32_.1_155/.72))]"
            aria-hidden="true"
          />
          <div className="pointer-events-none absolute -right-32 -top-24 size-96 rounded-full bg-emerald/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -left-20 size-80 rounded-full bg-gold/15 blur-3xl" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-2xl bg-primary-foreground/12 ring-1 ring-primary-foreground/20 backdrop-blur-sm">
                <Leaf className="size-6" aria-hidden="true" />
              </div>
              <div>
                <p className="font-display text-xl font-semibold tracking-tight">HALAL ERP</p>
                <p className="text-caption text-primary-foreground/65">Système d’exploitation métier</p>
              </div>
            </div>

            <div className="my-auto max-w-lg py-16 lg:py-0">
              <Badge variant="premium" appearance="soft" className="border-primary-foreground/15 bg-primary-foreground/10 text-primary-foreground">
                <Sparkles className="size-3" aria-hidden="true" />
                HALAL Field OS
              </Badge>
              <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-5xl">
                Votre entreprise,
                <span className="block text-emerald"> pleinement en mouvement.</span>
              </h1>
              <p className="mt-6 max-w-md text-base leading-7 text-primary-foreground/72">
                Transport, terrain, agriculture, stocks et finance réunis dans un espace de travail clair et sécurisé.
              </p>
            </div>

            <div className="flex items-center gap-3 text-sm text-primary-foreground/70">
              <span className="grid size-9 place-items-center rounded-xl bg-primary-foreground/10 ring-1 ring-primary-foreground/15">
                <ShieldCheck className="size-4" aria-hidden="true" />
              </span>
              Accès réservé aux utilisateurs autorisés.
            </div>
          </div>
        </div>

        <div className="flex items-center px-6 py-8 sm:px-10 sm:py-12 lg:px-12">
          <div className="w-full max-w-sm">
            <p className="text-overline text-primary">Espace sécurisé</p>
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">Bon retour.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Connectez-vous pour retrouver votre espace de travail.
            </p>

            <form onSubmit={handleSignIn} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username">Nom d’utilisateur</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  placeholder="keita"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button type="submit" className="mt-2 h-12 w-full" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                {loading ? "Connexion en cours…" : "Accéder à mon espace"}
              </Button>
            </form>
            <p className="mt-7 text-center text-caption text-muted-foreground">
              Les accès sont créés et administrés par HALAL &amp; CO.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
