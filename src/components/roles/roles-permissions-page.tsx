import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UsersRound, KeyRound, Save, Search, UserPlus, UserRoundCheck, UserRoundX, Pencil } from "lucide-react";
import { toast } from "sonner";

import {
  APP_ROLE_VALUES,
  getPermissionAdministration,
  getCurrentPermissions,
  getInternalAccounts,
  createInternalAccount,
  resetInternalAccountPassword,
  saveRolePermissions,
  saveUserRole,
  setInternalAccountActive,
  updateInternalAccount,
  type AppRole,
  type InternalAccount,
  type PermissionDefinition,
  type PermissionRole,
} from "@/lib/permissions.functions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { useConfirm } from "@/hooks/use-confirm";

const roleLabels: Record<AppRole, string> = {
  super_admin: "Super administrateur",
  admin: "Administrateur",
  comptable: "Comptable",
  rh: "Ressources humaines",
  operations: "Opérations",
  stocks: "Stocks",
  exploitations: "Exploitations",
  caissier: "Caissier",
  gestionnaire: "Gestionnaire",
  chauffeur: "Chauffeur",
  employe: "Employé",
  lecture_seule: "Lecture seule",
};

function getRole(value: string): AppRole {
  return APP_ROLE_VALUES.find((role) => role === value) ?? "lecture_seule";
}

function getRolePermissionSummary(role: PermissionRole, totalPermissions: number): string {
  if (role.code === "super_admin") {
    return `${totalPermissions} permissions · accès complet`;
  }

  return `${role.permission_codes.length} permissions`;
}

function formatModule(module: string): string {
  const labels: Record<string, string> = {
    dashboard: "Tableau de bord",
    employees: "Employés",
    drivers: "Chauffeurs",
    vehicles: "Véhicules",
    motorcycles: "Motos",
    farms: "Exploitations",
    harvests: "Récoltes",
    contracts: "Contrats",
    documents: "Documents",
    finance: "Finance",
    wallets: "Wallets",
    salaries: "Salaires",
    stocks: "Stocks",
    notifications: "Notifications",
    reports: "Rapports",
    settings: "Paramètres",
    roles: "Rôles",
    users: "Utilisateurs",
    security: "Sécurité",
  };
  return labels[module] ?? module;
}

export function RolesPermissionsPage() {
  const queryClient = useQueryClient();
  const administrationQuery = useQuery({
    queryKey: ["permission-administration"],
    queryFn: () => getPermissionAdministration(),
  });
  const permissionsQuery = useQuery({
    queryKey: ["current-permissions"],
    queryFn: () => getCurrentPermissions(),
  });
  const [selectedRole, setSelectedRole] = useState<AppRole>("gestionnaire");
  const [roleFilter, setRoleFilter] = useState("");
  const [pendingPermissionSave, setPendingPermissionSave] = useState<string[] | null>(null);

  const permissionCodes = new Set(permissionsQuery.data ?? []);
  const canManageRoles = permissionCodes.has("roles.manage");
  const canAssignRoles = permissionCodes.has("users.roles.assign");
  const canManageAccounts = permissionCodes.has("users.accounts.manage");
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["permission-administration"] }),
      queryClient.invalidateQueries({ queryKey: ["current-permissions"] }),
      queryClient.invalidateQueries({ queryKey: ["internal-accounts"] }),
    ]);
  };

  const roleMutation = useMutation({
    mutationFn: saveRolePermissions,
    onSuccess: async () => {
      await invalidate();
      toast.success("Permissions du rôle enregistrées.");
      setPendingPermissionSave(null);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Modification refusée."),
  });

  const assignmentMutation = useMutation({
    mutationFn: saveUserRole,
    onSuccess: async () => {
      await invalidate();
      toast.success("Attribution de rôle enregistrée.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Attribution refusée."),
  });

  if (administrationQuery.isLoading || permissionsQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Chargement des rôles et permissions…</div>;
  }
  if (administrationQuery.error || permissionsQuery.error || !administrationQuery.data) {
    return <div className="p-6"><Alert variant="destructive"><AlertTitle>Accès refusé</AlertTitle><AlertDescription>Vous n’avez pas la permission de consulter les rôles et permissions.</AlertDescription></Alert></div>;
  }

  const data = administrationQuery.data;
  const currentRole = data.roles.find((role) => role.code === selectedRole) ?? data.roles[0];
  const filteredRoles = data.roles.filter((role) => `${role.label} ${role.code}`.toLocaleLowerCase().includes(roleFilter.toLocaleLowerCase()));

  return (
    <PermissionGuard permission="roles.read">
      <div className="space-y-6 p-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold"><ShieldCheck className="h-7 w-7" /> Rôles & permissions</h1>
            <p className="mt-1 text-muted-foreground">Les bons accès aux bonnes personnes : le contrôle reste à la maison.</p>
          </div>
          <Badge variant="outline">Contrôles garantis par Supabase</Badge>
        </header>

        <Alert>
          <KeyRound className="h-4 w-4" />
          <AlertTitle>Rôles système</AlertTitle>
          <AlertDescription>
            Les rôles sont définis par l’enum Supabase existant. La création, duplication et l’archivage de rôles personnalisés ne sont pas proposés afin de ne pas créer un second modèle d’autorisation.
          </AlertDescription>
        </Alert>

        <section className="grid gap-6 xl:grid-cols-[minmax(260px,.52fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Rôles</CardTitle>
              <CardDescription>{data.roles.length} rôles système actifs.</CardDescription>
              <div className="relative pt-2"><Search className="absolute left-3 top-5 h-4 w-4 text-muted-foreground" /><Input value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="pl-9" placeholder="Rechercher un rôle" /></div>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredRoles.map((role) => <button key={role.code} type="button" onClick={() => setSelectedRole(role.code)} className={`w-full rounded-lg border p-3 text-left transition-colors ${currentRole?.code === role.code ? "border-primary bg-primary/5" : "hover:bg-muted"}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{role.label}</span><Badge variant="secondary">{role.user_count}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{getRolePermissionSummary(role, data.permissions.length)}</p></button>)}
            </CardContent>
          </Card>

          {currentRole && <RolePermissionEditor role={currentRole} permissions={data.permissions} editable={canManageRoles && currentRole.code !== "super_admin"} pending={roleMutation.isPending} onRequestSave={setPendingPermissionSave} />}
        </section>

        <RoleAssignments users={data.users} roles={data.roles} canAssign={canAssignRoles} canManageSuperAdministrators={canManageAccounts} pending={assignmentMutation.isPending} onAssign={(userId, role, assigned) => assignmentMutation.mutate({ data: { userId, role, assigned } })} />

        {canManageAccounts && <AccountManagement roles={data.roles} />}

        <AlertDialog open={pendingPermissionSave !== null} onOpenChange={(open) => { if (!open) setPendingPermissionSave(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Confirmer la modification des permissions</AlertDialogTitle><AlertDialogDescription>Le changement sera immédiatement appliqué côté base de données et journalisé dans l’audit de sécurité.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction disabled={!currentRole || pendingPermissionSave === null || roleMutation.isPending} onClick={() => { if (currentRole && pendingPermissionSave) roleMutation.mutate({ data: { role: currentRole.code, permissionCodes: pendingPermissionSave } }); }}>Confirmer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PermissionGuard>
  );
}

function AccountManagement({ roles }: { roles: PermissionRole[] }) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const accountsQuery = useQuery({ queryKey: ["internal-accounts"], queryFn: () => getInternalAccounts() });
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("employe");
  const [passwordTarget, setPasswordTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editingAccount, setEditingAccount] = useState<InternalAccount | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editRoles, setEditRoles] = useState<AppRole[]>([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["internal-accounts"] });
  const startEditing = (account: InternalAccount) => {
    setEditingAccount(account);
    setEditFullName(account.fullName ?? "");
    setEditUsername(account.username);
    setEditRoles(account.roles.length > 0 ? account.roles : ["lecture_seule"]);
  };

  const createMutation = useMutation({
    mutationFn: createInternalAccount,
    onSuccess: async () => {
      await refresh();
      setFullName(""); setUsername(""); setPassword(""); setRole("employe");
      toast.success("Accès interne créé.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Création du compte impossible."),
  });
  const statusMutation = useMutation({
    mutationFn: setInternalAccountActive,
    onSuccess: async () => { await refresh(); toast.success("Statut d’accès mis à jour."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Modification impossible."),
  });
  const passwordMutation = useMutation({
    mutationFn: resetInternalAccountPassword,
    onSuccess: () => { setPasswordTarget(null); setNewPassword(""); toast.success("Nouveau mot de passe enregistré."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Réinitialisation impossible."),
  });
  const updateMutation = useMutation({
    mutationFn: updateInternalAccount,
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ["current-user-identity"] }),
        queryClient.invalidateQueries({ queryKey: ["permission-administration"] }),
      ]);
      setEditingAccount(null);
      toast.success("Compte utilisateur mis à jour.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Modification du compte impossible."),
  });

  return <section className="space-y-4">
    <div>
      <h2 className="flex items-center gap-2 text-xl font-semibold"><KeyRound className="h-5 w-5" /> Accès des utilisateurs</h2>
      <p className="mt-1 text-sm text-muted-foreground">Réservé au super administrateur : vous choisissez l’identifiant, le mot de passe et le rôle initial. Aucune inscription libre n’est possible.</p>
    </div>
    <Card>
      <CardHeader><CardTitle>Créer un accès interne</CardTitle><CardDescription>L’utilisateur se connectera avec son nom d’utilisateur, jamais avec une adresse e-mail.</CardDescription></CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          if (!/^[a-z0-9._-]{3,40}$/i.test(username)) {
            toast.error("Le nom d’utilisateur ne doit pas être une adresse e-mail.");
            return;
          }
          createMutation.mutate({ data: { fullName, username, password, role } });
        }}>
          <div><Label htmlFor="account-full-name">Nom complet</Label><Input id="account-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nom de l’employé" required /></div>
          <div><Label htmlFor="account-username">Nom d’utilisateur</Label><Input id="account-username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="mariam.keita" pattern="[A-Za-z0-9._-]{3,40}" aria-invalid={username.includes("@") || undefined} required /><p className={`mt-1 text-xs ${username.includes("@") ? "text-destructive" : "text-muted-foreground"}`}>{username.includes("@") ? "Utilisez seulement mariam.keita, sans @gmail.com." : "3 à 40 caractères : lettres, chiffres, point, tiret ou _. Pas d’adresse e-mail."}</p></div>
          <div><Label htmlFor="account-password">Mot de passe initial</Label><Input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /><p className="mt-1 text-xs text-muted-foreground">Au moins 8 caractères. Communiquez-le directement à la personne.</p></div>
          <div><Label htmlFor="account-role">Rôle initial</Label><Select value={role} onValueChange={(value) => setRole(getRole(value))}><SelectTrigger id="account-role" className="h-9"><SelectValue /></SelectTrigger><SelectContent>{roles.filter((item) => item.is_active).map((item) => <SelectItem key={item.code} value={item.code}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="md:col-span-2"><Button type="submit" disabled={createMutation.isPending}><UserPlus className="mr-2 h-4 w-4" />Créer l’accès</Button></div>
        </form>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Comptes internes</CardTitle><CardDescription>Vous pouvez suspendre un accès immédiatement ou attribuer un nouveau mot de passe sans connaître l’ancien.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {accountsQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement des comptes…</p>}
        {accountsQuery.error && <Alert variant="destructive"><AlertTitle>Comptes indisponibles</AlertTitle><AlertDescription>La clé de service Supabase doit être configurée côté serveur pour gérer les accès.</AlertDescription></Alert>}
        {accountsQuery.data?.map((account) => <div key={account.userId} className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="font-medium">{account.fullName ?? account.username}</p><p className="text-sm text-muted-foreground">@{account.username} · {account.roles.map((item) => roleLabels[item]).join(", ") || "Aucun rôle"}</p></div>
          <div className="flex flex-wrap gap-2"><Badge variant={account.active ? "default" : "secondary"}>{account.active ? "Actif" : "Désactivé"}</Badge><Button type="button" variant="outline" size="sm" onClick={() => startEditing(account)}><Pencil className="mr-2 h-4 w-4" />Modifier</Button><Button type="button" variant="outline" size="sm" onClick={() => setPasswordTarget(account.userId)}><KeyRound className="mr-2 h-4 w-4" />Mot de passe</Button><Button type="button" variant={account.active ? "destructive" : "default"} size="sm" disabled={statusMutation.isPending} onClick={() => confirm({
            title: `${account.active ? "Désactiver" : "Réactiver"} l’accès de @${account.username} ?`,
            description: `L’accès de @${account.username} sera ${account.active ? "désactivé" : "réactivé"} immédiatement. Le changement sera appliqué côté base de données et journalisé dans l’audit de sécurité.`,
            variant: account.active ? "destructive" : "default",
            confirmLabel: account.active ? "Désactiver" : "Réactiver",
            onConfirm: async () => { await statusMutation.mutateAsync({ data: { userId: account.userId, active: !account.active } }); },
          })}>{account.active ? <UserRoundX className="mr-2 h-4 w-4" /> : <UserRoundCheck className="mr-2 h-4 w-4" />}{account.active ? "Désactiver" : "Réactiver"}</Button></div>
        </div>)}
      </CardContent>
    </Card>
    <AlertDialog open={passwordTarget !== null} onOpenChange={(open) => { if (!open) { setPasswordTarget(null); setNewPassword(""); } }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Réinitialiser le mot de passe</AlertDialogTitle><AlertDialogDescription>Choisissez un nouveau mot de passe d’au moins 8 caractères et transmettez-le de façon sécurisée.</AlertDialogDescription></AlertDialogHeader>
        <Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} placeholder="Nouveau mot de passe" />
        <AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction disabled={!passwordTarget || newPassword.length < 8 || passwordMutation.isPending} onClick={() => { if (passwordTarget) passwordMutation.mutate({ data: { userId: passwordTarget, password: newPassword } }); }}>Enregistrer</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={editingAccount !== null} onOpenChange={(open) => { if (!open) setEditingAccount(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Modifier le compte utilisateur</AlertDialogTitle><AlertDialogDescription>Modifiez le nom affiché, l'identifiant de connexion et les rôles. Les rôles sélectionnés se cumulent.</AlertDialogDescription></AlertDialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="edit-account-full-name">Nom complet</Label><Input id="edit-account-full-name" value={editFullName} onChange={(event) => setEditFullName(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="edit-account-username">Nom d'utilisateur</Label><Input id="edit-account-username" value={editUsername} onChange={(event) => setEditUsername(event.target.value.toLowerCase())} pattern="[A-Za-z0-9._-]{3,40}" aria-invalid={editUsername.includes("@") || undefined} required /><p className="text-xs text-muted-foreground">Sans adresse e-mail, 3 à 40 caractères.</p></div>
          <div className="space-y-2 sm:col-span-2"><Label>Rôles</Label><div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">{roles.filter((item) => item.is_active).map((item) => <label key={item.code} className="flex items-center gap-2 text-sm"><Checkbox checked={editRoles.includes(item.code)} onCheckedChange={(checked) => setEditRoles((current) => checked === true ? [...new Set([...current, item.code])] : current.filter((roleCode) => roleCode !== item.code))} />{item.label}</label>)}</div></div>
        </div>
        <AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><Button type="button" disabled={!editingAccount || editFullName.trim().length < 2 || !/^[a-z0-9._-]{3,40}$/i.test(editUsername) || editRoles.length === 0 || updateMutation.isPending} onClick={() => { if (editingAccount) updateMutation.mutate({ data: { userId: editingAccount.userId, fullName: editFullName, username: editUsername, roles: editRoles } }); }}>Enregistrer les modifications</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {dialog}
  </section>;
}

function RolePermissionEditor({ role, permissions, editable, pending, onRequestSave }: { role: PermissionRole; permissions: PermissionDefinition[]; editable: boolean; pending: boolean; onRequestSave: (codes: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>(role.permission_codes);
  useEffect(() => setSelected(role.permission_codes), [role]);
  const groups = usePermissionGroups(permissions);
  const selectedSet = new Set(selected);

  return <Card>
    <CardHeader>
      <CardTitle>{role.label}</CardTitle>
      <CardDescription>{role.description}</CardDescription>
      <div className="flex flex-wrap gap-2"><Badge variant="secondary"><UsersRound className="mr-1 h-3.5 w-3.5" />{role.user_count} utilisateur(s)</Badge><Badge variant="outline">{selected.length} permission(s)</Badge>{role.code === "super_admin" && <Badge>Permissions implicites</Badge>}</div>
    </CardHeader>
    <CardContent className="space-y-5">
      {groups.map((group) => <div key={group.module} className="rounded-lg border p-4"><h3 className="font-medium">{formatModule(group.module)}</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{group.permissions.map((permission) => <label key={permission.code} className="flex cursor-pointer items-start gap-2 rounded-md p-1 text-sm"><Checkbox checked={selectedSet.has(permission.code) || role.code === "super_admin"} disabled={!editable || role.code === "super_admin"} onCheckedChange={(checked) => setSelected((current) => checked === true ? [...new Set([...current, permission.code])] : current.filter((code) => code !== permission.code))} /><span><span className="block font-medium">{permission.code}</span><span className="text-xs text-muted-foreground">{permission.description}</span></span></label>)}</div></div>)}
      {editable ? <Button disabled={pending} onClick={() => onRequestSave(selected)}><Save className="mr-2 h-4 w-4" /> Enregistrer les permissions</Button> : <p className="text-sm text-muted-foreground">La modification de ce rôle système est réservée au super administrateur.</p>}
    </CardContent>
  </Card>;
}

function usePermissionGroups(permissions: PermissionDefinition[]) {
  return useMemo(() => {
    const groups = new Map<string, typeof permissions>();
    for (const permission of permissions) groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission]);
    return [...groups.entries()].map(([module, rows]) => ({ module, permissions: rows.sort((left, right) => left.code.localeCompare(right.code)) })).sort((left, right) => left.module.localeCompare(right.module));
  }, [permissions]);
}

function RoleAssignments({ users, roles, canAssign, canManageSuperAdministrators, pending, onAssign }: { users: Array<{ user_id: string; full_name: string | null; roles: AppRole[] }>; roles: PermissionRole[]; canAssign: boolean; canManageSuperAdministrators: boolean; pending: boolean; onAssign: (userId: string, role: AppRole, assigned: boolean) => void }) {
  const [query, setQuery] = useState("");
  const { confirm, dialog } = useConfirm();
  const filteredUsers = users.filter((user) => `${user.full_name ?? ""} ${user.user_id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <Card>
    <CardHeader><CardTitle>Attributions utilisateurs</CardTitle><CardDescription>Un utilisateur cumule les permissions de tous ses rôles. Les protections du dernier super administrateur sont appliquées par la RPC.</CardDescription><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un utilisateur" /></CardHeader>
    <CardContent className="space-y-4">
      {filteredUsers.length === 0 && <p className="text-sm text-muted-foreground">Aucun utilisateur ne correspond à la recherche.</p>}
      {filteredUsers.map((user) => { const protectedAccount = user.roles.includes("super_admin") && !canManageSuperAdministrators; return <div key={user.user_id} className="rounded-lg border p-4"><p className="font-medium">{user.full_name ?? "Utilisateur sans nom"}</p><p className="mb-3 text-xs text-muted-foreground">{user.user_id}</p>{protectedAccount && <p className="mb-3 text-xs text-muted-foreground">Seul un super administrateur peut modifier les rôles de ce compte.</p>}<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{roles.map((role) => { const assigned = user.roles.includes(role.code); return <label key={role.code} className="flex items-center gap-2 text-sm"><Checkbox checked={assigned} disabled={!canAssign || pending || protectedAccount} onCheckedChange={(checked) => {
                if (checked === assigned) return;
                const willAssign = checked === true;
                confirm({
                  title: `${willAssign ? "Attribuer" : "Retirer"} le rôle ${roleLabels[role.code]} ?`,
                  description: `Le rôle ${roleLabels[role.code]} sera ${willAssign ? "attribué à" : "retiré à"} ${user.full_name ?? "cet utilisateur"}. Le changement sera immédiatement appliqué côté base de données et journalisé dans l’audit de sécurité.`,
                  confirmLabel: willAssign ? "Attribuer" : "Retirer",
                  onConfirm: async () => { onAssign(user.user_id, role.code, willAssign); },
                });
              }} />{role.label}</label>; })}</div></div>; })}
      {!canAssign && <p className="text-sm text-muted-foreground">Vous pouvez consulter les attributions, mais pas les modifier.</p>}
    </CardContent>
    {dialog}
  </Card>;
}
