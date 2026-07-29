import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Leaf, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,.18),_transparent_30rem)] p-4">
      <Card className="w-full max-w-md overflow-hidden shadow-2xl">
        <div className="bg-emerald-950 p-7 text-white">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400 text-emerald-950">
              <Leaf className="h-6 w-6" />
            </div>
            <div>
              <p className="text-lg font-semibold">HALAL &amp; CO</p>
              <p className="text-xs text-emerald-100/70">Espace de travail Keita</p>
            </div>
          </div>
          <p className="mt-6 text-sm leading-6 text-emerald-100/80">
            Accès interne sécurisé par identifiant et mot de passe.
          </p>
        </div>
        <div className="p-6">
          <form onSubmit={handleSignIn} className="space-y-4">
                <div>
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
                <div>
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
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Se connecter
                </Button>
          </form>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Les accès sont créés et administrés par HALAL &amp; CO.
          </p>
        </div>
      </Card>
    </div>
  );
}
