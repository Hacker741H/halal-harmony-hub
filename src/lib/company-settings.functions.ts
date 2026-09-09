import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type CompanySettings = Tables<"company_settings">;

// SÉPARATION NOM APPLICATION / NOM ENTREPRISE : point d'entrée unique pour
// lire public.company_settings (singleton -- une seule ligne) côté
// serveur. alert-settings.functions.ts (getAlertSettings) interroge déjà
// cette même table pour son propre besoin (fuseau horaire des
// notifications, via un Promise.all groupé avec 5 autres sources) --
// laissé tel quel, pas de raison de le faire dépendre de cette fonction.
// Ce fichier est le point d'entrée pour TOUT AUTRE besoin de
// company_settings ailleurs dans l'app (voir useCompanySettings,
// src/hooks/use-company-settings.ts) : aucun nouveau composant ne doit
// écrire sa propre requête `.from("company_settings")`.
//
// Aucune permission dédiée : la RLS existante (settings_read, "USING
// (true)") autorise déjà tout utilisateur authentifié à lire cette table
// -- requireSupabaseAuth (session valide) suffit, comme pour les autres
// lectures qui s'appuient uniquement sur la RLS.
export const getCompanySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompanySettings | null> => {
    const { data, error } = await context.supabase
      .from("company_settings")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  });
