import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ALERT_SEVERITIES,
  APP_ROLES,
  getAlertSettings,
  runNotificationsManually,
  saveInventoryAlertThreshold,
  saveNotificationAlertRule,
  saveNotificationGeneralSettings,
  saveWalletAlertThreshold,
  type AlertRule,
  type AppRole,
  type NotificationGenerationRun,
} from "@/lib/alert-settings.functions";
import type { Json } from "@/integrations/supabase/types";

type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

const roleLabels: Record<AppRole, string> = {
  super_admin: "Super administrateur",
  admin: "Administrateur",
  comptable: "Comptable",
  rh: "Ressources humaines",
  operations: "Opérations",
  stocks: "Stocks",
  exploitations: "Exploitations",
  gestionnaire: "Gestionnaire",
  chauffeur: "Chauffeur",
  employe: "Employé",
  lecture_seule: "Lecture seule",
};

function formatRunDate(value: string | null): string {
  if (!value) return "Jamais";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function scheduleFromJson(value: Json, fallback: AlertSeverity): Record<string, AlertSeverity> {
  const result: Record<string, AlertSeverity> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, candidate] of Object.entries(value)) {
    if (candidate === "INFO" || candidate === "WARNING" || candidate === "CRITICAL") {
      result[key] = candidate;
    }
  }
  if (!result.overdue) result.overdue = "CRITICAL";
  if (!result["0"]) result["0"] = result.overdue ?? fallback;
  return result;
}

function parseDueDays(value: string): number[] | null {
  const clean = value.trim();
  if (!clean) return [];
  const values = clean.split(",").map((part) => Number(part.trim()));
  if (values.some((day) => !Number.isInteger(day) || day < 0 || day > 365)) return null;
  return [...new Set(values)].sort((left, right) => right - left);
}

function runSummary(run: NotificationGenerationRun): string {
  return `${run.created_count} créée(s), ${run.updated_count} mise(s) à jour, ${run.resolved_count} résolue(s)`;
}

export function AlertSettingsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["alert-settings"], queryFn: () => getAlertSettings() });
  const settings = settingsQuery.data;
  const [timezone, setTimezone] = useState("Africa/Dakar");
  const [dailyRunTime, setDailyRunTime] = useState("06:00");

  useEffect(() => {
    if (!settings?.company) return;
    setTimezone(settings.company.timezone);
    setDailyRunTime(settings.company.notification_daily_run_time.slice(0, 5));
  }, [settings?.company]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["alert-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["notification-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
    ]);
  };

  const generalMutation = useMutation({
    mutationFn: saveNotificationGeneralSettings,
    onSuccess: async () => {
      await invalidate();
      toast.success("Fuseau horaire et heure quotidienne enregistrés.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Enregistrement impossible."),
  });

  const generationMutation = useMutation({
    mutationFn: runNotificationsManually,
    onSuccess: async (run) => {
      await invalidate();
      toast.success(`Alertes actualisées : ${runSummary(run)}.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Génération impossible."),
  });

  if (settingsQuery.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Chargement des paramètres…</p>;
  }
  if (settingsQuery.error || !settings) {
    return <Alert variant="destructive"><AlertTitle>Paramètres indisponibles</AlertTitle><AlertDescription>Impossible de charger la configuration des alertes.</AlertDescription></Alert>;
  }

  const canManageGeneral = settings.canManageAlertRules;
  const nextExecution = settings.schedulerConfigured
    ? `Selon l’heure ${dailyRunTime} (${timezone}).`
    : "Indisponible : la planification serveur n’est pas encore activée.";

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,.65fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" /> Général</CardTitle>
            <CardDescription>Le fuseau de l’entreprise est la source de vérité pour les échéances.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="notification-timezone">Fuseau horaire métier</Label>
              <Input
                id="notification-timezone"
                value={timezone}
                disabled={!canManageGeneral}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="Africa/Dakar"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notification-run-time">Heure quotidienne</Label>
              <Input
                id="notification-run-time"
                type="time"
                value={dailyRunTime}
                disabled={!canManageGeneral}
                onChange={(event) => setDailyRunTime(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                disabled={!canManageGeneral || generalMutation.isPending}
                onClick={() => generalMutation.mutate({ data: { timezone, dailyRunTime } })}
              >
                <Save className="mr-2 h-4 w-4" /> Enregistrer le planning
              </Button>
              {!canManageGeneral && <p className="mt-2 text-sm text-muted-foreground">Modification réservée aux administrateurs.</p>}
            </div>
          </CardContent>
        </Card>

        <SchedulerHealth
          run={settings.latestRun}
          schedulerConfigured={settings.schedulerConfigured}
          nextExecution={nextExecution}
          canRun={settings.canManageAlertRules || settings.canManageStockThresholds}
          pending={generationMutation.isPending}
          onRun={() => generationMutation.mutate({ data: undefined })}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Alertes et échéances</h2>
          <p className="text-sm text-muted-foreground">Les délais, gravités et destinataires sont appliqués par le moteur SQL central.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {settings.rules.map((rule) => (
            <AlertRuleCard
              key={rule.id}
              rule={rule}
              disabled={!settings.canManageAlertRules}
              onSaved={invalidate}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <ThresholdSection
          title="Finances"
          description="Le seuil global est configuré sur la règle LOW_WALLET; chaque wallet peut le surcharger sans modifier son solde."
          rows={settings.wallets.map((wallet) => ({
            id: wallet.id,
            label: wallet.name,
            detail: `Solde : ${new Intl.NumberFormat("fr-FR").format(Number(wallet.balance ?? 0))} FCFA`,
            threshold: wallet.alert_threshold,
          }))}
          nullable
          disabled={!settings.canManageWalletThresholds}
          onSave={async (id, threshold) => {
            await saveWalletAlertThreshold({ data: { id, threshold } });
            await invalidate();
          }}
        />
        <ThresholdSection
          title="Stocks"
          description="Le seuil reste une propriété de chaque article; aucun paramètre générique ne le duplique."
          rows={settings.inventoryItems.map((item) => ({
            id: item.id,
            label: item.nom,
            detail: `Stock actuel : ${new Intl.NumberFormat("fr-FR").format(Number(item.stock_actuel))}`,
            threshold: item.seuil_alerte,
          }))}
          disabled={!settings.canManageStockThresholds}
          onSave={async (id, threshold) => {
            if (threshold === null) throw new Error("Le seuil de stock est obligatoire.");
            await saveInventoryAlertThreshold({ data: { id, threshold } });
            await invalidate();
          }}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Entretiens et sécurité</CardTitle>
          <CardDescription>
            Les entretiens moto sont évalués selon leur date ou kilométrage déjà enregistrés. Le modèle actuel ne porte pas encore de fréquence globale véhicule ou moto à configurer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="secondary">Date d’entretien moto</Badge>
          <Badge variant="secondary">Kilométrage moto</Badge>
          <Badge variant="outline">Écritures journalisées</Badge>
          <Badge variant="outline">RLS et RPC sécurisées</Badge>
        </CardContent>
      </Card>
    </div>
  );
}

function SchedulerHealth({
  run,
  schedulerConfigured,
  nextExecution,
  canRun,
  pending,
  onRun,
}: {
  run: NotificationGenerationRun | null;
  schedulerConfigured: boolean;
  nextExecution: string;
  canRun: boolean;
  pending: boolean;
  onRun: () => void;
}) {
  const failed = run?.status === "FAILED";
  return (
    <Card className={failed ? "border-destructive/50" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" /> État de santé</CardTitle>
        <CardDescription>Une seule exécution est sérialisée dans la base.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3"><span>Planification serveur</span><Badge variant={schedulerConfigured ? "default" : "secondary"}>{schedulerConfigured ? "Active" : "À activer"}</Badge></div>
        <div className="flex items-center justify-between gap-3"><span>Dernière génération</span><strong>{formatRunDate(run?.completed_at ?? null)}</strong></div>
        <div className="flex items-center justify-between gap-3"><span>Statut</span><strong>{run?.status ?? "Aucune exécution"}</strong></div>
        <div className="flex items-center justify-between gap-3"><span>Résultat</span><strong>{run ? runSummary(run) : "—"}</strong></div>
        <p className="rounded-md bg-muted p-3 text-muted-foreground">Prochaine exécution : {nextExecution}</p>
        {failed && run?.error_message && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Dernière exécution en erreur</AlertTitle><AlertDescription>{run.error_message}</AlertDescription></Alert>}
        <Button className="w-full" disabled={!canRun || pending} onClick={onRun}>
          <RefreshCw className={"mr-2 h-4 w-4 " + (pending ? "animate-spin" : "")} /> Actualiser les alertes
        </Button>
      </CardContent>
    </Card>
  );
}

function AlertRuleCard({ rule, disabled, onSaved }: { rule: AlertRule; disabled: boolean; onSaved: () => Promise<void> }) {
  const initialDueDays = rule.due_days.join(", ");
  const initialSchedule = useMemo(
    () => scheduleFromJson(rule.severity_schedule, toAlertSeverity(rule.default_severity)),
    [rule.default_severity, rule.severity_schedule],
  );
  const [enabled, setEnabled] = useState(rule.enabled);
  const [defaultSeverity, setDefaultSeverity] = useState<AlertSeverity>(toAlertSeverity(rule.default_severity));
  const [dueDays, setDueDays] = useState(initialDueDays);
  const [threshold, setThreshold] = useState(rule.threshold?.toString() ?? "");
  const [recipientRoles, setRecipientRoles] = useState<AppRole[]>(rule.recipient_roles);
  const [schedule, setSchedule] = useState<Record<string, AlertSeverity>>(initialSchedule);

  useEffect(() => {
    setEnabled(rule.enabled);
    setDefaultSeverity(toAlertSeverity(rule.default_severity));
    setDueDays(rule.due_days.join(", "));
    setThreshold(rule.threshold?.toString() ?? "");
    setRecipientRoles(rule.recipient_roles);
    setSchedule(scheduleFromJson(rule.severity_schedule, toAlertSeverity(rule.default_severity)));
  }, [rule]);

  const mutation = useMutation({
    mutationFn: saveNotificationAlertRule,
    onSuccess: async () => {
      await onSaved();
      toast.success(`Règle ${rule.alert_type} enregistrée.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Règle non enregistrée."),
  });

  const parsedDueDays = parseDueDays(dueDays);
  const usesDueDays = rule.due_days.length > 0;

  const save = () => {
    if (parsedDueDays === null) {
      toast.error("Les délais doivent être des jours entiers entre 0 et 365.");
      return;
    }
    const parsedThreshold = threshold.trim() === "" ? null : Number(threshold);
    if (parsedThreshold !== null && (!Number.isFinite(parsedThreshold) || parsedThreshold < 0)) {
      toast.error("Le seuil doit être un montant positif ou nul.");
      return;
    }
    mutation.mutate({
      data: {
        alertType: rule.alert_type,
        enabled,
        defaultSeverity,
        dueDays: parsedDueDays,
        severitySchedule: schedule,
        threshold: parsedThreshold,
        recipientRoles,
      },
    });
  };

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">{rule.alert_type}</CardTitle>
          <CardDescription className="mt-1">{rule.description ?? "Règle d’alerte métier."}</CardDescription>
        </div>
        <div className="flex items-center gap-2"><Label htmlFor={`rule-${rule.id}`}>Active</Label><Switch id={`rule-${rule.id}`} checked={enabled} disabled={disabled} onCheckedChange={setEnabled} /></div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Gravité par défaut</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={defaultSeverity} disabled={disabled} onChange={(event) => setDefaultSeverity(event.target.value as AlertSeverity)}>
              {ALERT_SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
            </select>
          </div>
          {rule.alert_type === "LOW_WALLET" && (
            <div className="space-y-2"><Label>Seuil global (FCFA)</Label><Input type="number" min="0" value={threshold} disabled={disabled} onChange={(event) => setThreshold(event.target.value)} placeholder="Désactivé si vide" /></div>
          )}
        </div>

        {usesDueDays && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-2"><Label>Délais avant échéance (jours, séparés par des virgules)</Label><Input value={dueDays} disabled={disabled} onChange={(event) => setDueDays(event.target.value)} placeholder="30, 15, 7" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {["overdue", "0", ...(parsedDueDays ?? []) .map(String)].filter((item, index, values) => values.indexOf(item) === index).map((stage) => (
                <label key={stage} className="space-y-1 text-sm">
                  <span>{stage === "overdue" ? "Échu" : stage === "0" ? "Jour de l’échéance" : `À ${stage} jour(s)`}</span>
                  <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={schedule[stage] ?? defaultSeverity} disabled={disabled} onChange={(event) => setSchedule((current) => ({ ...current, [stage]: event.target.value as AlertSeverity }))}>
                    {ALERT_SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2"><Label>Rôles destinataires</Label><div className="grid gap-2 sm:grid-cols-2">{APP_ROLES.map((role) => <label key={role} className="flex items-center gap-2 text-sm"><Checkbox checked={recipientRoles.includes(role)} disabled={disabled} onCheckedChange={(checked) => setRecipientRoles((current) => checked === true ? [...new Set([...current, role])] : current.filter((item) => item !== role))} />{roleLabels[role]}</label>)}</div></div>
        <Button disabled={disabled || mutation.isPending || recipientRoles.length === 0} onClick={save}><Save className="mr-2 h-4 w-4" /> Enregistrer la règle</Button>
      </CardContent>
    </Card>
  );
}

function ThresholdSection({
  title,
  description,
  rows,
  nullable = false,
  disabled,
  onSave,
}: {
  title: string;
  description: string;
  rows: Array<{ id: string; label: string; detail: string; threshold: number | null }>;
  nullable?: boolean;
  disabled: boolean;
  onSave: (id: string, threshold: number | null) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Aucune donnée disponible.</p>}
        {rows.map((row) => <ThresholdRow key={row.id} row={row} nullable={nullable} disabled={disabled} onSave={onSave} />)}
      </CardContent>
    </Card>
  );
}

function ThresholdRow({ row, nullable, disabled, onSave }: { row: { id: string; label: string; detail: string; threshold: number | null }; nullable: boolean; disabled: boolean; onSave: (id: string, threshold: number | null) => Promise<void> }) {
  const [value, setValue] = useState(row.threshold?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(row.threshold?.toString() ?? ""), [row.threshold]);
  const save = async () => {
    const threshold = value.trim() === "" ? null : Number(value);
    if ((threshold === null && !nullable) || (threshold !== null && (!Number.isFinite(threshold) || threshold < 0))) {
      toast.error("Saisissez un seuil positif ou nul.");
      return;
    }
    try {
      setSaving(true);
      await onSave(row.id, threshold);
      toast.success("Seuil enregistré.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Seuil non enregistré.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"><div><p className="font-medium">{row.label}</p><p className="text-xs text-muted-foreground">{row.detail}</p></div><div className="space-y-1"><Label>Seuil</Label><Input type="number" min="0" value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} placeholder={nullable ? "Global" : "0"} /></div><Button variant="outline" disabled={disabled || saving} onClick={save}>Enregistrer</Button></div>;
}

function toAlertSeverity(value: string): AlertSeverity {
  return value === "INFO" || value === "CRITICAL" ? value : "WARNING";
}
