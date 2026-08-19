import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BanknoteArrowDown,
  BanknoteArrowUp,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CloudOff,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Unlink,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/use-confirm";
import { usePermissions } from "@/hooks/use-permissions";
import {
  assignFieldWallet,
  cancelFieldReport,
  confirmFieldDeclaration,
  createFieldDeclaration,
  createImmediateFieldReceipt,
  createFieldReport,
  FIELD_DECLARATION_TYPES,
  FIELD_REPORT_TYPES,
  getFieldAssignableWallets,
  getFieldAssignmentCandidates,
  getFieldReport,
  getFieldReports,
  getFieldWallets,
  revokeFieldWalletAssignment,
  rejectFieldDeclaration,
  submitFieldReport,
  type FieldAssignableUser,
  type FieldAssignableWallet,
  type FieldDeclaration,
  type FieldDeclarationValues,
  type FieldReport,
  type FieldWallet,
} from "@/lib/field-reports.functions";
import {
  getOfflineFieldDeclarationDrafts,
  removeOfflineFieldDeclarationDraft,
  saveOfflineFieldDeclarationDraft,
  type OfflineFieldDeclarationDraft,
} from "@/lib/field-offline-drafts";

const REPORT_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "À contrôler",
  REVIEWED: "Contrôlé",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
};

const DECLARATION_LABELS: Record<string, string> = {
  RECEIPT: "Recette",
  EXPENSE: "Dépense",
  REMITTANCE: "Versement",
};

const DECLARATION_ICONS = {
  RECEIPT: BanknoteArrowUp,
  EXPENSE: BanknoteArrowDown,
  REMITTANCE: ArrowLeftRight,
} as const;

function reportVariant(status: string): "success" | "warning" | "danger" | "outline" | "info" {
  if (status === "REVIEWED") return "success";
  if (status === "SUBMITTED") return "warning";
  if (status === "REJECTED") return "danger";
  if (status === "DRAFT") return "info";
  return "outline";
}

function declarationVariant(status: string): "success" | "warning" | "danger" | "outline" | "info" {
  if (status === "CONFIRMED") return "success";
  if (status === "SUBMITTED") return "warning";
  if (status === "REJECTED") return "danger";
  if (status === "DRAFT") return "info";
  return "outline";
}

function formatAmount(value: number) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value)} FCFA`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function useOnlineStatus() {
  // A stable initial value prevents a server/client rendering mismatch. The real
  // browser status is read immediately after hydration.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const setConnected = () => setOnline(true);
    const setDisconnected = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", setConnected);
    window.addEventListener("offline", setDisconnected);
    return () => {
      window.removeEventListener("online", setConnected);
      window.removeEventListener("offline", setDisconnected);
    };
  }, []);

  return online;
}

function createClientSubmissionId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : null;
}

export function FieldWorkspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can, isPending: permissionsPending } = usePermissions();
  const { confirm, dialog } = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<FieldWallet | null>(null);
  const reportsQuery = useQuery({
    queryKey: ["field-reports", "all"],
    queryFn: () => getFieldReports({ data: { page: 1, pageSize: 30, status: null } }),
    enabled: can("field.reports.read"),
  });
  const walletsQuery = useQuery({
    queryKey: ["field-wallets"],
    queryFn: () => getFieldWallets(),
    // The server and RLS remain authoritative: this query can only return wallets
    // explicitly assigned to the connected person. Keeping it independent of the
    // client permission cache avoids hiding a valid assignment while that cache
    // is being refreshed after a role or wallet assignment change.
    enabled: !permissionsPending,
  });
  const assignmentUsersQuery = useQuery({
    queryKey: ["field-wallet-assignment-candidates"],
    queryFn: () => getFieldAssignmentCandidates(),
    enabled: can("field.wallets.assign"),
  });
  const assignmentWalletsQuery = useQuery({
    queryKey: ["field-assignable-wallets"],
    queryFn: () => getFieldAssignableWallets(),
    enabled: can("field.wallets.assign"),
  });
  const revokeAssignmentMutation = useMutation({
    mutationFn: (assignmentId: string) => revokeFieldWalletAssignment({ data: { assignmentId } }),
    onSuccess: () => {
      toast.success("Affectation wallet retirée. Le wallet et son historique restent inchangés.");
      void queryClient.invalidateQueries({ queryKey: ["field-wallets"] });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const handleAssignmentOpenChange = (open: boolean) => {
    setAssignmentOpen(open);
    if (!open) setEditingAssignment(null);
  };

  if (permissionsPending) return <FieldWorkspaceSkeleton />;
  if (!can("field.reports.read")) return <AccessDenied />;

  const reports = reportsQuery.data?.reports ?? [];
  const submittedCount = reports.filter((report) => report.status === "SUBMITTED").length;
  const draftsCount = reports.filter((report) => report.status === "DRAFT").length;

  return (
    <main className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
      <section className="relative isolate overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-surface px-5 py-6 shadow-md sm:px-7 sm:py-8">
        <div
          className="pointer-events-none absolute -right-20 -top-16 size-64 rounded-full bg-primary/15 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-overline text-primary">HALAL Field · Terrain</p>
            <h1 className="mt-2 flex items-center gap-3 text-h1">
              <ClipboardList className="size-7 text-primary" aria-hidden="true" />
              Rapports terrain
            </h1>
            <p className="mt-3 text-body-sm leading-6 text-muted-foreground sm:text-base">
              Enregistrez vos recettes, dépenses et versements. Les recettes immédiates autorisées
              sont créditées et tracées à l’enregistrement ; les autres mouvements restent soumis
              au contrôle Finance.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("field.wallets.assign") ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingAssignment(null);
                  setAssignmentOpen(true);
                }}
              >
                <WalletCards className="size-4" aria-hidden="true" />
                Affecter un wallet
              </Button>
            ) : null}
            {can("field.reports.create") ? (
              <Button onClick={() => setCreateOpen(true)}>
                <ClipboardList className="size-4" aria-hidden="true" />
                Nouveau rapport
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Brouillons"
          value={reportsQuery.isPending ? "—" : String(draftsCount)}
          description="À compléter"
        />
        <StatCard
          label="À contrôler"
          value={reportsQuery.isPending ? "—" : String(submittedCount)}
          description="En attente de Finance"
          tone="warning"
        />
        <StatCard
          label="Wallets affectés"
          value={walletsQuery.isPending ? "—" : walletsQuery.isError ? "!" : String(walletsQuery.data?.length ?? 0)}
          description={walletsQuery.isError ? "Actualisation requise" : "Source ou destination"}
          tone="success"
        />
      </div>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card variant="section">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Mes rapports</CardTitle>
              <CardDescription>
                Les recettes immédiates autorisées sont déjà confirmées ; les autres mouvements
                sont envoyés pour contrôle.
              </CardDescription>
            </div>
            {reports.length > 0 ? (
              <span className="text-caption text-muted-foreground">
                {reportsQuery.data?.total ?? reports.length} au total
              </span>
            ) : null}
          </CardHeader>
          <CardContent>
            {reportsQuery.isPending ? (
              <ReportsSkeleton />
            ) : reportsQuery.isError ? (
              <QueryError onRetry={() => void reportsQuery.refetch()} />
            ) : reports.length === 0 ? (
              <EmptyReports
                canCreate={can("field.reports.create")}
                onCreate={() => setCreateOpen(true)}
              />
            ) : (
              <div className="space-y-3">
                {reports.map((report) => (
                  <ReportCard key={report.id} report={report} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <AssignedWallets
          wallets={walletsQuery.data ?? []}
          users={assignmentUsersQuery.data ?? []}
          loading={walletsQuery.isPending}
          error={walletsQuery.isError}
          canManage={can("field.wallets.assign")}
          onRetry={() => void walletsQuery.refetch()}
          revokingId={
            revokeAssignmentMutation.isPending ? (revokeAssignmentMutation.variables ?? null) : null
          }
          onEdit={(assignment) => {
            setEditingAssignment(assignment);
            setAssignmentOpen(true);
          }}
          onRevoke={(assignment) => {
            confirm({
              title: "Retirer l’accès terrain",
              description: `Retirer l’accès terrain au wallet « ${assignment.label || assignment.wallet.name} » ? Le wallet, son solde et son historique ne seront pas supprimés.`,
              variant: "destructive",
              onConfirm: async () => {
                await revokeAssignmentMutation.mutateAsync(assignment.id);
              },
            });
          }}
        />
      </section>
      <ReportDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(report) =>
          void navigate({ to: "/field/$reportId", params: { reportId: report.id } })
        }
      />
      <WalletAssignmentDialog
        open={assignmentOpen}
        onOpenChange={handleAssignmentOpenChange}
        users={assignmentUsersQuery.data ?? []}
        wallets={assignmentWalletsQuery.data ?? []}
        assignment={editingAssignment}
        loading={assignmentUsersQuery.isPending || assignmentWalletsQuery.isPending}
        error={assignmentUsersQuery.isError || assignmentWalletsQuery.isError}
        onAssigned={() => {
          void queryClient.invalidateQueries({ queryKey: ["field-wallets"] });
        }}
      />
      {dialog}
    </main>
  );
}

export function FieldReportWorkspace({ reportId }: { reportId: string }) {
  const { can, isPending: permissionsPending } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [declarationOpen, setDeclarationOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rejecting, setRejecting] = useState<FieldDeclaration | null>(null);
  const [offlineDrafts, setOfflineDrafts] = useState<OfflineFieldDeclarationDraft[]>([]);
  const [offlineDraftsLoading, setOfflineDraftsLoading] = useState(true);
  const [syncingOfflineDrafts, setSyncingOfflineDrafts] = useState(false);
  const reportQuery = useQuery({
    queryKey: ["field-report", reportId],
    queryFn: () => getFieldReport({ data: reportId }),
    enabled: can("field.reports.read"),
  });
  const walletsQuery = useQuery({
    queryKey: ["field-wallets"],
    queryFn: () => getFieldWallets(),
    enabled: !permissionsPending,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["field-report", reportId] });
    void queryClient.invalidateQueries({ queryKey: ["field-reports"] });
    void queryClient.invalidateQueries({ queryKey: ["field-wallets"] });
  };
  const refreshOfflineDrafts = async () => {
    try {
      setOfflineDraftsLoading(true);
      setOfflineDrafts(await getOfflineFieldDeclarationDrafts(reportId));
    } catch (error) {
      console.warn("Impossible de lire les brouillons terrain locaux.", error);
    } finally {
      setOfflineDraftsLoading(false);
    }
  };

  useEffect(() => {
    void refreshOfflineDrafts();
  }, [reportId]);

  const saveOfflineDraft = async (values: FieldDeclarationValues) => {
    if (!values.clientSubmissionId)
      throw new Error("Cet appareil ne peut pas générer une clé de synchronisation sécurisée.");
    await saveOfflineFieldDeclarationDraft({
      clientSubmissionId: values.clientSubmissionId,
      reportId,
      values,
      savedAt: new Date().toISOString(),
    });
    await refreshOfflineDrafts();
  };
  const synchronizeOfflineDrafts = async () => {
    if (!online || offlineDrafts.length === 0 || syncingOfflineDrafts) return;
    setSyncingOfflineDrafts(true);
    try {
      for (const draft of offlineDrafts) {
        await createFieldDeclaration({ data: { reportId: draft.reportId, values: draft.values } });
        await removeOfflineFieldDeclarationDraft(draft.clientSubmissionId);
      }
      await refreshOfflineDrafts();
      invalidate();
      toast.success("Les brouillons terrain ont été synchronisés.");
    } catch (error) {
      toast.error(
        `${errorMessage(error)} Les brouillons non synchronisés restent sur cet appareil.`,
      );
      await refreshOfflineDrafts();
    } finally {
      setSyncingOfflineDrafts(false);
    }
  };
  const submitMutation = useMutation({
    mutationFn: () => submitFieldReport({ data: { id: reportId } }),
    onSuccess: () => {
      toast.success("Rapport envoyé pour contrôle.");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelFieldReport({ data: { id: reportId } }),
    onSuccess: async () => {
      const draftCleanup = await Promise.allSettled(
        offlineDrafts.map((draft) => removeOfflineFieldDeclarationDraft(draft.clientSubmissionId)),
      );
      setOfflineDrafts([]);
      setCancelOpen(false);
      toast.success("Rapport abandonné. Aucun wallet ni aucune écriture financière n’a été modifié.");
      if (draftCleanup.some((result) => result.status === "rejected")) {
        toast.warning("Le rapport est abandonné, mais certains brouillons locaux doivent être retirés de cet appareil.");
      }
      invalidate();
      void navigate({ to: "/field" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmFieldDeclaration({ data: { id } }),
    onSuccess: () => {
      toast.success("Déclaration confirmée et comptabilisée.");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectFieldDeclaration({ data: { id, reason } }),
    onSuccess: () => {
      toast.success("Déclaration refusée avec justification.");
      setRejecting(null);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (permissionsPending || reportQuery.isPending) return <FieldReportSkeleton />;
  if (!can("field.reports.read")) return <AccessDenied />;
  if (reportQuery.isError || !reportQuery.data)
    return (
      <main className="mx-auto max-w-(--ds-content-max-width) p-4 sm:p-6 xl:p-8">
        <QueryError onRetry={() => void reportQuery.refetch()} />
      </main>
    );

  const report = reportQuery.data;
  const sourceWallets = (walletsQuery.data ?? []).filter(
    (item) => item.assignment_type === "SOURCE",
  );
  const destinationWallets = (walletsQuery.data ?? []).filter(
    (item) => item.assignment_type === "DESTINATION",
  );
  const walletNames = new Map(
    (walletsQuery.data ?? []).map((item) => [item.wallet_id, item.label || item.wallet.name]),
  );
  const canEdit = report.status === "DRAFT" && can("field.reports.create");
  const canSubmit = report.status === "DRAFT" && can("field.reports.submit");
  const canCancel =
    report.status === "DRAFT" &&
    can("field.reports.create") &&
    report.declarations.every((declaration) => declaration.status === "DRAFT");
  const canConfirm = can("field.reports.confirm");
  const canReview = can("field.reports.review");

  return (
    <main className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Link to="/field" className="inline-flex items-center gap-1 hover:text-foreground">
          <ChevronRight className="size-4 rotate-180" aria-hidden="true" />
          Rapports terrain
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-foreground">{report.report_number}</span>
      </div>
      <section className="flex flex-col gap-5 rounded-2xl border bg-surface-elevated/50 p-5 shadow-sm sm:p-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-overline text-primary">
              Rapport {report.report_type === "DAILY" ? "quotidien" : "hebdomadaire"}
            </p>
            <Badge variant={reportVariant(report.status)} appearance="soft">
              {REPORT_LABELS[report.status] ?? report.status}
            </Badge>
          </div>
          <h1 className="mt-2 text-h1">{report.report_number}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Période : {formatDate(report.period_start)} — {formatDate(report.period_end)}
          </p>
          {report.notes ? (
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{report.notes}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Button variant="outline" onClick={() => setDeclarationOpen(true)}>
              <BanknoteArrowUp className="size-4" aria-hidden="true" />
              Ajouter une déclaration
            </Button>
          ) : null}
          {canSubmit ? (
            <Button
              disabled={
                submitMutation.isPending ||
                offlineDraftsLoading ||
                report.declarations.length === 0 ||
                offlineDrafts.length > 0
              }
              onClick={() => submitMutation.mutate()}
            >
              <Send className="size-4" aria-hidden="true" />
              {submitMutation.isPending ? "Envoi…" : "Envoyer au contrôle"}
            </Button>
          ) : null}
          {canCancel ? (
            <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline">
                  <XCircle className="size-4" aria-hidden="true" />
                  Abandonner le rapport
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Abandonner ce rapport ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Le rapport et ses déclarations brouillon seront marqués comme annulés et resteront
                    dans l’historique. Aucun wallet ni aucune écriture financière ne sera modifié.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={cancelMutation.isPending}>
                    Conserver le rapport
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={cancelMutation.isPending}
                    onClick={(event) => {
                      event.preventDefault();
                      cancelMutation.mutate();
                    }}
                  >
                    {cancelMutation.isPending ? "Abandon…" : "Abandonner le rapport"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </section>
      {offlineDrafts.length > 0 && canSubmit ? (
        <p className="-mt-3 text-caption text-warning-foreground">
          Synchronisez les brouillons locaux avant d’envoyer ce rapport au contrôle.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Recettes déclarées" value={formatAmount(report.totals.receipts)} />
        <StatCard
          label="Dépenses déclarées"
          value={formatAmount(report.totals.expenses)}
          tone="warning"
        />
        <StatCard label="Versements" value={formatAmount(report.totals.remittances)} />
        <StatCard label="À confirmer" value={formatAmount(report.totals.pending)} tone="warning" />
        <StatCard label="Confirmé" value={formatAmount(report.totals.confirmed)} tone="success" />
      </div>
      <OfflineDraftsPanel
        drafts={offlineDrafts}
        loading={offlineDraftsLoading}
        online={online}
        syncing={syncingOfflineDrafts}
        onSynchronize={() => void synchronizeOfflineDrafts()}
      />
      <Card variant="section">
        <CardHeader>
          <CardTitle>Déclarations</CardTitle>
          <CardDescription>
            Une confirmation crée une seule écriture finance_operations, contrôlée côté serveur.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.declarations.length === 0 ? (
            <EmptyDeclarations canEdit={canEdit} onAdd={() => setDeclarationOpen(true)} />
          ) : (
            <div className="space-y-3">
              {report.declarations.map((declaration) => (
                <DeclarationCard
                  key={declaration.id}
                  declaration={declaration}
                  canConfirm={canConfirm}
                  canReview={canReview}
                  confirming={confirmMutation.isPending}
                  fieldWalletName={walletNames.get(declaration.field_wallet_id) ?? null}
                  destinationWalletName={
                    declaration.destination_wallet_id
                      ? (walletNames.get(declaration.destination_wallet_id) ?? null)
                      : null
                  }
                  onConfirm={() => confirmMutation.mutate(declaration.id)}
                  onReject={() => setRejecting(declaration)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <DeclarationDialog
        reportId={report.id}
        sourceWallets={sourceWallets}
        destinationWallets={destinationWallets}
        walletsError={walletsQuery.isError}
        onRetryWallets={() => void walletsQuery.refetch()}
        online={online}
        open={declarationOpen}
        onOpenChange={setDeclarationOpen}
        onCreated={invalidate}
        onSaveOffline={saveOfflineDraft}
      />
      <RejectDialog
        declaration={rejecting}
        open={Boolean(rejecting)}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        pending={rejectMutation.isPending}
        onReject={(reason) => rejecting && rejectMutation.mutate({ id: rejecting.id, reason })}
      />
    </main>
  );
}

function OfflineDraftsPanel({
  drafts,
  loading,
  online,
  syncing,
  onSynchronize,
}: {
  drafts: OfflineFieldDeclarationDraft[];
  loading: boolean;
  online: boolean;
  syncing: boolean;
  onSynchronize: () => void;
}) {
  if (loading || (online && drafts.length === 0)) return null;

  return (
    <Card variant="information" className="border-primary/20 bg-primary/5">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <CloudOff className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium">
              {online
                ? `${drafts.length} brouillon${drafts.length > 1 ? "s" : ""} à synchroniser`
                : "Mode hors connexion"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {online
                ? "Les déclarations restent locales jusqu’à votre synchronisation. Aucun wallet n’est modifié avant le contrôle Finance."
                : "Vous pouvez enregistrer une déclaration locale pour ce rapport déjà ouvert. Aucun mouvement financier ne sera créé hors connexion."}
            </p>
          </div>
        </div>
        {online && drafts.length > 0 ? (
          <Button disabled={syncing} onClick={onSynchronize}>
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
            {syncing ? "Synchronisation…" : "Synchroniser"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReportCard({ report }: { report: FieldReport }) {
  return (
    <Link
      to="/field/$reportId"
      params={{ reportId: report.id }}
      className="block rounded-xl border border-border/75 bg-surface p-4 transition-ui hover:border-primary/35 hover:bg-primary/5 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{report.report_number}</p>
            <Badge variant={reportVariant(report.status)} appearance="soft">
              {REPORT_LABELS[report.status] ?? report.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.report_type === "DAILY" ? "Rapport quotidien" : "Rapport hebdomadaire"} ·{" "}
            {formatDate(report.period_start)} — {formatDate(report.period_end)}
          </p>
          {report.notes ? <p className="mt-2 truncate text-caption">{report.notes}</p> : null}
        </div>
        <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </Link>
  );
}

function DeclarationCard({
  declaration,
  canConfirm,
  canReview,
  confirming,
  fieldWalletName,
  destinationWalletName,
  onConfirm,
  onReject,
}: {
  declaration: FieldDeclaration;
  canConfirm: boolean;
  canReview: boolean;
  confirming: boolean;
  fieldWalletName: string | null;
  destinationWalletName: string | null;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const Icon =
    DECLARATION_ICONS[declaration.declaration_type as keyof typeof DECLARATION_ICONS] ??
    ClipboardList;
  const statusLabel =
    declaration.status === "CONFIRMED"
      ? "Confirmée"
      : declaration.status === "SUBMITTED"
        ? "À confirmer"
        : declaration.status === "DRAFT"
          ? "Brouillon"
          : declaration.status === "REJECTED"
            ? "Refusée"
            : declaration.status;
  return (
    <article className="rounded-xl border border-border/75 bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">
                {DECLARATION_LABELS[declaration.declaration_type] ?? declaration.declaration_type}
              </p>
              <Badge variant={declarationVariant(declaration.status)} appearance="soft">
                {statusLabel}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {declaration.category} ·{" "}
              {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(declaration.occurred_at),
              )}
            </p>
            {declaration.description ? (
              <p className="mt-1 text-caption">{declaration.description}</p>
            ) : null}
            {declaration.rejection_reason ? (
              <p className="mt-2 text-caption text-destructive">
                Motif : {declaration.rejection_reason}
              </p>
            ) : null}
            {declaration.status === "CONFIRMED" && fieldWalletName ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1 text-caption font-medium text-success-foreground">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                {declaration.declaration_type === "REMITTANCE" && destinationWalletName
                  ? `Transfert confirmé : ${fieldWalletName} → ${destinationWalletName}`
                  : `Confirmée dans le wallet ${fieldWalletName}`}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <p className="mr-auto font-semibold tabular-nums sm:mr-2">
            {formatAmount(Number(declaration.amount))}
          </p>
          {declaration.status === "SUBMITTED" && canConfirm ? (
            <Button disabled={confirming} onClick={onConfirm}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Confirmer
            </Button>
          ) : null}
          {declaration.status === "SUBMITTED" && canReview ? (
            <Button variant="outline" onClick={onReject}>
              <XCircle className="size-4" aria-hidden="true" />
              Refuser
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ReportDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (report: FieldReport) => void;
}) {
  const [reportType, setReportType] = useState<(typeof FIELD_REPORT_TYPES)[number]>("DAILY");
  const [periodStart, setPeriodStart] = useState(today());
  const [periodEnd, setPeriodEnd] = useState(today());
  const [notes, setNotes] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createFieldReport({
        data: { reportType, periodStart, periodEnd, notes: notes.trim() || null },
      }),
    onSuccess: (report) => {
      toast.success("Rapport terrain créé.");
      onOpenChange(false);
      onCreated(report);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const changeType = (value: (typeof FIELD_REPORT_TYPES)[number]) => {
    setReportType(value);
    if (value === "DAILY") setPeriodEnd(periodStart);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau rapport terrain</DialogTitle>
          <DialogDescription>
            Créez un rapport avant d’y ajouter vos recettes, dépenses ou versements.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Rythme</Label>
            <Select
              value={reportType}
              onValueChange={(value) => changeType(value as (typeof FIELD_REPORT_TYPES)[number])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAILY">Quotidien</SelectItem>
                <SelectItem value="WEEKLY">Hebdomadaire</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Date de début</Label>
              <Input
                type="date"
                value={periodStart}
                onChange={(event) => {
                  setPeriodStart(event.target.value);
                  if (reportType === "DAILY") setPeriodEnd(event.target.value);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Date de fin</Label>
              <Input
                type="date"
                value={periodEnd}
                min={periodStart}
                disabled={reportType === "DAILY"}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>
              Note <span className="font-normal text-muted-foreground">(facultative)</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ex. tournée du marché, ventes de la journée…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={!periodStart || !periodEnd || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Création…" : "Créer le rapport"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeclarationDialog({
  reportId,
  sourceWallets,
  destinationWallets,
  walletsError,
  onRetryWallets,
  online,
  open,
  onOpenChange,
  onCreated,
  onSaveOffline,
}: {
  reportId: string;
  sourceWallets: FieldWallet[];
  destinationWallets: FieldWallet[];
  walletsError: boolean;
  onRetryWallets: () => void;
  online: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onSaveOffline: (values: FieldDeclarationValues) => Promise<void>;
}) {
  const [declarationType, setDeclarationType] =
    useState<(typeof FIELD_DECLARATION_TYPES)[number]>("RECEIPT");
  const [amount, setAmount] = useState("");
  const [sourceWalletId, setSourceWalletId] = useState("");
  const [destinationWalletId, setDestinationWalletId] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [clientSubmissionId, setClientSubmissionId] = useState<string | null>(() =>
    createClientSubmissionId(),
  );
  const [savingOffline, setSavingOffline] = useState(false);
  const needsDestination = declarationType === "REMITTANCE";

  useEffect(() => {
    if (!open) return;

    setSourceWalletId((currentWalletId) => {
      if (sourceWallets.some((item) => item.wallet_id === currentWalletId)) {
        return currentWalletId;
      }

      return sourceWallets.length === 1 ? sourceWallets[0].wallet_id : "";
    });
  }, [open, sourceWallets]);

  const sourceWallet = sourceWallets.find((item) => item.wallet_id === sourceWalletId);
  const canCreditImmediately =
    online && declarationType === "RECEIPT" && sourceWallet?.allow_immediate_receipts === true;
  const disabled =
    !sourceWalletId ||
    !category.trim() ||
    Number(amount) <= 0 ||
    (needsDestination && !destinationWalletId);
  const declarationValues = (): FieldDeclarationValues => ({
    declarationType,
    amount: Number(amount),
    occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
    fieldWalletId: sourceWalletId,
    destinationWalletId: needsDestination ? destinationWalletId || null : null,
    category,
    description: description.trim() || null,
    reference: reference.trim() || null,
    clientId: null,
    farmId: null,
    inventoryItemId: null,
    documentId: null,
    clientSubmissionId,
  });
  const reset = () => {
    setAmount("");
    setCategory("");
    setDescription("");
    setReference("");
    setClientSubmissionId(createClientSubmissionId());
  };
  const mutation = useMutation({
    mutationFn: () => createFieldDeclaration({ data: { reportId, values: declarationValues() } }),
    onSuccess: () => {
      toast.success("Déclaration ajoutée au rapport.");
      onOpenChange(false);
      reset();
      onCreated();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const immediateReceiptMutation = useMutation({
    mutationFn: () =>
      createImmediateFieldReceipt({ data: { reportId, values: declarationValues() } }),
    onSuccess: () => {
      toast.success("Recette confirmée et wallet crédité.");
      onOpenChange(false);
      reset();
      onCreated();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const actionIsPending = mutation.isPending || immediateReceiptMutation.isPending || savingOffline;
  const actionLabel = !online
    ? savingOffline
      ? "Enregistrement…"
      : "Enregistrer hors connexion"
    : canCreditImmediately
      ? immediateReceiptMutation.isPending
        ? "Crédit…"
        : "Créditer le wallet"
      : mutation.isPending
        ? "Ajout…"
        : "Ajouter";
  const saveOffline = async () => {
    if (!clientSubmissionId) {
      toast.error("Cet appareil ne peut pas sécuriser ce brouillon hors connexion.");
      return;
    }
    setSavingOffline(true);
    try {
      await onSaveOffline(declarationValues());
      toast.success("Brouillon enregistré sur cet appareil.");
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSavingOffline(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ajouter une déclaration</DialogTitle>
          <DialogDescription>
            {online
              ? "Le solde n’est jamais modifié ici : l’écriture finance_operations est créée uniquement après validation par Finance."
              : "Ce brouillon sera conservé sur cet appareil. Aucun wallet ni mouvement financier ne sera modifié avant la synchronisation et le contrôle Finance."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nature</Label>
              <Select
                value={declarationType}
                onValueChange={(value) =>
                  setDeclarationType(value as (typeof FIELD_DECLARATION_TYPES)[number])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECEIPT">Recette encaissée</SelectItem>
                  <SelectItem value="EXPENSE">Dépense payée</SelectItem>
                  <SelectItem value="REMITTANCE">Versement à l’entreprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Montant (FCFA)</Label>
              <Input
                type="number"
                min="1"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Wallet terrain</Label>
            <Select value={sourceWalletId} onValueChange={setSourceWalletId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner votre wallet" />
              </SelectTrigger>
              <SelectContent>
                {sourceWallets.map((item) => (
                  <SelectItem key={item.id} value={item.wallet_id}>
                    {item.label || item.wallet.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sourceWallets.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-caption text-warning-foreground">
                <p>
                  {walletsError
                    ? "La liste des wallets n’a pas pu être chargée."
                    : "Aucun wallet source ne vous est affecté. Demandez une affectation à Finance."}
                </p>
                {walletsError ? (
                  <Button type="button" size="sm" variant="outline" onClick={onRetryWallets}>
                    Réessayer
                  </Button>
                ) : null}
              </div>
            ) : null}
            {sourceWallets.length === 1 && sourceWallet ? (
              <p className="text-caption text-muted-foreground">
                Wallet terrain affecté : <span className="font-medium text-foreground">{sourceWallet.label || sourceWallet.wallet.name}</span>
              </p>
            ) : null}
            {canCreditImmediately ? (
              <p className="rounded-xl border border-success/25 bg-success/5 p-3 text-caption text-success-foreground">
                Recettes immédiates autorisées pour ce wallet : cette recette sera confirmée,
                inscrite dans le journal financier et créditera ce wallet maintenant. Les dépenses
                et versements restent soumis au contrôle Finance.
              </p>
            ) : null}
          </div>
          {needsDestination ? (
            <div className="space-y-2">
              <Label>Wallet de l’entreprise</Label>
              <Select value={destinationWalletId} onValueChange={setDestinationWalletId}>
                <SelectTrigger>
                  <SelectValue placeholder="Wallet destinataire autorisé" />
                </SelectTrigger>
                <SelectContent>
                  {destinationWallets.map((item) => (
                    <SelectItem key={item.id} value={item.wallet_id}>
                      {item.label || item.wallet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {destinationWallets.length === 0 ? (
                <p className="text-caption text-warning-foreground">
                  Aucun wallet destinataire autorisé. Demandez à Finance de le définir avant le
                  versement.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Catégorie</Label>
              <Input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder={
                  declarationType === "RECEIPT"
                    ? "Vente, récolte…"
                    : declarationType === "EXPENSE"
                      ? "Carburant, achat…"
                      : "Versement"
                }
              />
            </div>
            <div className="space-y-2">
              <Label>
                Date et heure{" "}
                <span className="font-normal text-muted-foreground">(facultatif)</span>
              </Label>
              <Input
                type="datetime-local"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>
              Description <span className="font-normal text-muted-foreground">(facultative)</span>
            </Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Précisez le contexte de la déclaration…"
            />
          </div>
          <div className="space-y-2">
            <Label>
              Référence <span className="font-normal text-muted-foreground">(facultative)</span>
            </Label>
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="N° reçu, référence mobile money…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={disabled || actionIsPending}
            onClick={() => {
              if (online && canCreditImmediately) immediateReceiptMutation.mutate();
              else if (online) mutation.mutate();
              else void saveOffline();
            }}
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WalletAssignmentDialog({
  open,
  onOpenChange,
  users,
  wallets,
  assignment,
  loading,
  error,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: FieldAssignableUser[];
  wallets: FieldAssignableWallet[];
  assignment: FieldWallet | null;
  loading: boolean;
  error: boolean;
  onAssigned: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [assignmentType, setAssignmentType] = useState<"SOURCE" | "DESTINATION">("SOURCE");
  const [label, setLabel] = useState("");
  const [allowImmediateReceipts, setAllowImmediateReceipts] = useState(false);
  useEffect(() => {
    if (!open) return;
    setUserId(assignment?.user_id ?? "");
    setWalletId(assignment?.wallet_id ?? "");
    setAssignmentType(assignment?.assignment_type === "DESTINATION" ? "DESTINATION" : "SOURCE");
    setLabel(assignment?.label ?? "");
    setAllowImmediateReceipts(assignment?.allow_immediate_receipts ?? false);
  }, [assignment, open]);

  const mutation = useMutation({
    mutationFn: () =>
      assignFieldWallet({
        data: {
          userId,
          walletId,
          assignmentType,
          label: label.trim() || null,
          allowImmediateReceipts: assignmentType === "SOURCE" ? allowImmediateReceipts : false,
        },
      }),
    onSuccess: () => {
      toast.success(assignment ? "Affectation wallet mise à jour." : "Wallet terrain affecté.");
      onOpenChange(false);
      onAssigned();
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {assignment ? "Modifier l’affectation wallet" : "Affecter un wallet terrain"}
          </DialogTitle>
          <DialogDescription>
            Une affectation source autorise les recettes et dépenses. Une affectation destination
            autorise uniquement les versements vers l’entreprise.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : error ? (
          <p className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
            Impossible de charger les utilisateurs ou wallets disponibles.
          </p>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Collaborateur</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un collaborateur" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.userId} value={user.userId}>
                      {user.fullName || user.username || "Utilisateur sans nom"}
                      {user.username && user.fullName ? ` · ${user.username}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Wallet</Label>
              <Select value={walletId} onValueChange={setWalletId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un wallet" />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((wallet) => (
                    <SelectItem key={wallet.id} value={wallet.id}>
                      {wallet.name} · {formatAmount(Number(wallet.balance ?? 0))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Usage autorisé</Label>
              <Select
                value={assignmentType}
                onValueChange={(value) => setAssignmentType(value as "SOURCE" | "DESTINATION")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SOURCE">Wallet terrain (recettes et dépenses)</SelectItem>
                  <SelectItem value="DESTINATION">Wallet entreprise (versements reçus)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {assignmentType === "SOURCE" ? (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-surface/70 p-4">
                <div className="space-y-1">
                  <Label htmlFor="field-immediate-receipts">Recettes immédiates</Label>
                  <p className="text-caption text-muted-foreground">
                    Autorise ce collaborateur à confirmer une recette et créditer directement ce
                    wallet. Les dépenses et versements restent contrôlés par Finance.
                  </p>
                </div>
                <Switch
                  id="field-immediate-receipts"
                  checked={allowImmediateReceipts}
                  onCheckedChange={setAllowImmediateReceipts}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>
                Libellé <span className="font-normal text-muted-foreground">(facultatif)</span>
              </Label>
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Ex. Caisse commerciale Abidjan"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={loading || error || !userId || !walletId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Enregistrement…" : assignment ? "Enregistrer" : "Affecter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  declaration,
  open,
  onOpenChange,
  pending,
  onReject,
}: {
  declaration: FieldDeclaration | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refuser la déclaration</DialogTitle>
          <DialogDescription>
            Le motif est enregistré dans l’historique et visible à l’auteur.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="field-rejection-reason">Motif</Label>
          <Textarea
            id="field-rejection-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={5}
            placeholder="Expliquez la correction attendue…"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            disabled={pending || reason.trim().length < 5 || !declaration}
            onClick={() => onReject(reason.trim())}
          >
            {pending ? "Refus…" : "Refuser"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignedWallets({
  wallets,
  users,
  loading,
  error,
  canManage,
  revokingId,
  onRetry,
  onEdit,
  onRevoke,
}: {
  wallets: FieldWallet[];
  users: FieldAssignableUser[];
  loading: boolean;
  error: boolean;
  canManage: boolean;
  revokingId: string | null;
  onRetry: () => void;
  onEdit: (assignment: FieldWallet) => void;
  onRevoke: (assignment: FieldWallet) => void;
}) {
  return (
    <Card variant="information">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <WalletCards className="size-4 text-primary" aria-hidden="true" />
          Wallets affectés
        </CardTitle>
        <CardDescription>
          {canManage ? "Affectations terrain actives." : "Vos wallets terrain autorisés."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Impossible de récupérer vos wallets.</p>
            <p className="mt-1 text-caption text-muted-foreground">
              Votre affectation reste inchangée. Actualisez la liste avant de déclarer un mouvement.
            </p>
            <Button className="mt-3" type="button" size="sm" variant="outline" onClick={onRetry}>
              Réessayer
            </Button>
          </div>
        ) : wallets.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Finance doit vous affecter un wallet avant toute déclaration.
          </p>
        ) : (
          <div className="space-y-3">
            {wallets.map((item) => {
              const assignee = users.find((user) => user.userId === item.user_id);
              const assigneeLabel = assignee?.fullName || assignee?.username || "Collaborateur";
              return (
                <div key={item.id} className="rounded-xl border border-border/70 bg-surface/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {item.label || item.wallet.name}
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {formatAmount(Number(item.wallet.balance ?? 0))}
                    </p>
                    {canManage ? (
                      <p className="mt-1 text-caption text-muted-foreground">
                        Affecté à {assigneeLabel}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge
                      variant={item.assignment_type === "SOURCE" ? "info" : "success"}
                      appearance="soft"
                    >
                      {item.assignment_type === "SOURCE" ? "Terrain" : "Entreprise"}
                    </Badge>
                    {item.allow_immediate_receipts ? (
                      <Badge variant="success" appearance="soft">
                        Recettes immédiates
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => onEdit(item)}>
                      <Pencil className="size-3.5" aria-hidden="true" />
                      Modifier
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={revokingId === item.id}
                      onClick={() => onRevoke(item)}
                    >
                      <Unlink className="size-3.5" aria-hidden="true" />
                      {revokingId === item.id ? "Retrait…" : "Retirer"}
                    </Button>
                  </div>
                ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  description,
  tone = "default",
}: {
  label: string;
  value: string;
  description?: string;
  tone?: "default" | "warning" | "success";
}) {
  const color =
    tone === "warning"
      ? "text-warning-foreground"
      : tone === "success"
        ? "text-success"
        : "text-primary";
  return (
    <Card variant="compact">
      <CardContent className="p-4">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className={`mt-2 truncate text-xl font-semibold tabular-nums ${color}`} title={value}>
          {value}
        </p>
        {description ? (
          <p className="mt-1 text-caption text-muted-foreground">{description}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyReports({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <ClipboardList className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 font-medium">Aucun rapport terrain</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Créez votre premier rapport quotidien ou hebdomadaire pour préparer les déclarations à
        contrôler.
      </p>
      {canCreate ? (
        <Button className="mt-4" onClick={onCreate}>
          Créer un rapport
        </Button>
      ) : null}
    </div>
  );
}

function EmptyDeclarations({ canEdit, onAdd }: { canEdit: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">Aucune déclaration</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Ajoutez une recette, une dépense ou un versement à ce rapport.
      </p>
      {canEdit ? (
        <Button className="mt-4" onClick={onAdd}>
          Ajouter une déclaration
        </Button>
      ) : null}
    </div>
  );
}

function QueryError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5">
      <p className="font-medium text-destructive">Impossible de charger ces données.</p>
      <p className="mt-1 text-sm text-muted-foreground">Vérifiez votre connexion puis réessayez.</p>
      <Button className="mt-4" variant="outline" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}

function AccessDenied() {
  return (
    <main className="mx-auto max-w-(--ds-content-max-width) p-4 sm:p-6 xl:p-8">
      <Card variant="information">
        <CardContent className="flex gap-3 p-6 text-sm">
          <ShieldCheck className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-medium">Accès non autorisé</p>
            <p className="mt-1 text-muted-foreground">
              Vous n’avez pas la permission de consulter les rapports terrain.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full" />
      ))}
    </div>
  );
}

function FieldWorkspaceSkeleton() {
  return (
    <main className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
      <Skeleton className="h-52 w-full" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-80 w-full" />
    </main>
  );
}

function FieldReportSkeleton() {
  return (
    <main className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-44 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-72 w-full" />
    </main>
  );
}
