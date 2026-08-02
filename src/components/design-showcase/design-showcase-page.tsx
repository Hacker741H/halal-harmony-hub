import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  Copy,
  FileText,
  Info,
  Keyboard,
  LayoutDashboard,
  Menu,
  Moon,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
} from "recharts";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Combobox } from "@/components/ui/combobox";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ShowcaseSectionId =
  | "foundations"
  | "buttons"
  | "inputs"
  | "cards"
  | "badges"
  | "dialogs"
  | "tables"
  | "navigation"
  | "feedback"
  | "charts"
  | "forms"
  | "motion"
  | "icons"
  | "accessibility";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "success";
type ButtonSize = "sm" | "default" | "lg";
type CardVariant = "analytics" | "kpi" | "glass" | "compact" | "section" | "information";
type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info" | "premium";
type BadgeAppearance = "soft" | "solid" | "outline";

interface ShowcaseNavItem {
  id: ShowcaseSectionId;
  label: string;
  Icon: LucideIcon;
}

interface DemoRow {
  id: string;
  component: string;
  family: string;
  state: "Prêt" | "À vérifier" | "Nouveau";
  updatedAt: string;
}

const showcaseNavigation: readonly ShowcaseNavItem[] = [
  { id: "foundations", label: "Fondations", Icon: Palette },
  { id: "buttons", label: "Boutons", Icon: Sparkles },
  { id: "inputs", label: "Champs", Icon: Type },
  { id: "cards", label: "Cartes", Icon: LayoutDashboard },
  { id: "badges", label: "Badges", Icon: ShieldCheck },
  { id: "dialogs", label: "Overlays", Icon: Menu },
  { id: "tables", label: "Tableaux", Icon: Table2 },
  { id: "navigation", label: "Navigation", Icon: ChevronRight },
  { id: "feedback", label: "Retours", Icon: Bell },
  { id: "charts", label: "Graphiques", Icon: Activity },
  { id: "forms", label: "Formulaires", Icon: FileText },
  { id: "motion", label: "Motion", Icon: Sparkles },
  { id: "icons", label: "Icônes", Icon: Palette },
  { id: "accessibility", label: "Accessibilité", Icon: Keyboard },
];

const buttonExamples: readonly { label: string; variant: ButtonVariant }[] = [
  { label: "Primary", variant: "primary" },
  { label: "Secondary", variant: "secondary" },
  { label: "Ghost", variant: "ghost" },
  { label: "Outline", variant: "outline" },
  { label: "Danger", variant: "danger" },
  { label: "Success", variant: "success" },
];

const buttonSizes: readonly { label: string; size: ButtonSize }[] = [
  { label: "Petit", size: "sm" },
  { label: "Standard", size: "default" },
  { label: "Grand", size: "lg" },
];

const cardExamples: readonly { title: string; description: string; variant: CardVariant }[] = [
  { title: "Analytics", description: "Synthèse et tendances", variant: "analytics" },
  { title: "KPI", description: "Information prioritaire", variant: "kpi" },
  { title: "Glass", description: "Élévation très légère", variant: "glass" },
  { title: "Compact", description: "Densité maîtrisée", variant: "compact" },
  { title: "Section", description: "Regroupement de contenu", variant: "section" },
  { title: "Information", description: "Contexte utile", variant: "information" },
];

const badgeVariants: readonly BadgeVariant[] = ["neutral", "success", "warning", "danger", "info", "premium"];
const badgeAppearances: readonly BadgeAppearance[] = ["soft", "solid", "outline"];

const demoRows: readonly DemoRow[] = [
  { id: "foundation", component: "Surface", family: "Foundation", state: "Prêt", updatedAt: "Aujourd’hui" },
  { id: "button", component: "Button", family: "Action", state: "Prêt", updatedAt: "Aujourd’hui" },
  { id: "input", component: "Combobox", family: "Formulaire", state: "Nouveau", updatedAt: "Hier" },
  { id: "table", component: "DataTable", family: "Donnée", state: "À vérifier", updatedAt: "Cette semaine" },
  { id: "dialog", component: "Dialog", family: "Overlay", state: "Prêt", updatedAt: "Cette semaine" },
  { id: "chart", component: "Chart", family: "Visualisation", state: "Nouveau", updatedAt: "Ce mois" },
];

const tableColumns: readonly DataTableColumn<DemoRow>[] = [
  {
    id: "component",
    header: "Composant",
    cell: (row) => <span className="font-medium text-foreground">{row.component}</span>,
    sortValue: (row) => row.component,
  },
  {
    id: "family",
    header: "Famille",
    cell: (row) => <span className="text-muted-foreground">{row.family}</span>,
    sortValue: (row) => row.family,
    hideOnMobile: true,
  },
  {
    id: "state",
    header: "État",
    cell: (row) => <StateBadge state={row.state} />,
    sortValue: (row) => row.state,
  },
  {
    id: "updatedAt",
    header: "Actualisé",
    cell: (row) => <span className="text-muted-foreground">{row.updatedAt}</span>,
    sortValue: (row) => row.updatedAt,
    hideOnMobile: true,
  },
];

const comboboxOptions = [
  { value: "surface", label: "Surface", description: "Couleur de contenu" },
  { value: "primary", label: "Primary", description: "Action principale" },
  { value: "success", label: "Success", description: "Retour positif" },
];

const chartConfig = {
  activity: { label: "Activité", color: "var(--primary)" },
  quality: { label: "Qualité", color: "var(--success)" },
  attention: { label: "Attention", color: "var(--warning)" },
} satisfies ChartConfig;

const chartData = [
  { label: "Lun", activity: 42, quality: 28, attention: 10 },
  { label: "Mar", activity: 58, quality: 34, attention: 16 },
  { label: "Mer", activity: 49, quality: 46, attention: 12 },
  { label: "Jeu", activity: 71, quality: 52, attention: 8 },
  { label: "Ven", activity: 64, quality: 48, attention: 14 },
];

const pieData = [
  { name: "Primary", value: 42, color: "var(--primary)" },
  { name: "Success", value: 28, color: "var(--success)" },
  { name: "Warning", value: 18, color: "var(--warning)" },
  { name: "Info", value: 12, color: "var(--info)" },
];

const iconExamples: readonly { name: string; Icon: LucideIcon }[] = [
  { name: "Activity", Icon: Activity },
  { name: "Alert", Icon: AlertTriangle },
  { name: "Bell", Icon: Bell },
  { name: "Palette", Icon: Palette },
  { name: "Search", Icon: Search },
  { name: "Settings", Icon: Settings2 },
  { name: "Shield", Icon: ShieldCheck },
  { name: "Info", Icon: Info },
];

function StateBadge({ state }: { state: DemoRow["state"] }) {
  const variant: Record<DemoRow["state"], BadgeVariant> = {
    "Prêt": "success",
    "À vérifier": "warning",
    "Nouveau": "info",
  };

  return <Badge variant={variant[state]} appearance="soft">{state}</Badge>;
}

function ShowcaseSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: ShowcaseSectionId;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-5" aria-labelledby={`${id}-title`}>
      <header className="max-w-3xl space-y-1.5">
        <p className="text-overline text-primary">{eyebrow}</p>
        <h2 id={`${id}-title`} className="text-h2">{title}</h2>
        <p className="text-body-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

function PreviewMeta({ code, tokens }: { code: string; tokens: readonly string[] }) {
  const [isCodeVisible, setIsCodeVisible] = React.useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Exemple copié", { description: "Le code de démonstration est dans le presse-papiers." });
    } catch {
      toast.error("Copie indisponible", { description: "Votre navigateur n’autorise pas l’accès au presse-papiers." });
    }
  };

  return (
    <div className="border-t border-border-subtle px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-overline text-muted-foreground">Tokens</span>
        {tokens.map((token) => <code key={token} className="rounded-md bg-muted px-1.5 py-0.5 text-caption text-foreground">{token}</code>)}
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsCodeVisible((visible) => !visible)}>
            <Code2 aria-hidden="true" />
            {isCodeVisible ? "Masquer" : "Code"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { void copyCode(); }}>
            <Copy aria-hidden="true" />
            Copier
          </Button>
        </div>
      </div>
      {isCodeVisible ? (
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-surface-sunken p-3 text-caption text-foreground"><code>{code}</code></pre>
      ) : null}
    </div>
  );
}

function ShowcaseFrame({
  title,
  description,
  code,
  tokens,
  children,
  className,
}: {
  title: string;
  description?: string;
  code: string;
  tokens: readonly string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card variant="section" className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-1 border-b border-border-subtle p-4 sm:p-5">
        <CardTitle className="text-h4">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="p-4 sm:p-5">{children}</CardContent>
      <PreviewMeta code={code} tokens={tokens} />
    </Card>
  );
}

function FoundationsShowcase() {
  const colors = [
    { name: "Background", className: "bg-background", text: "text-foreground" },
    { name: "Surface", className: "bg-surface", text: "text-foreground" },
    { name: "Primary", className: "bg-primary", text: "text-primary-foreground" },
    { name: "Secondary", className: "bg-secondary", text: "text-secondary-foreground" },
    { name: "Success", className: "bg-success", text: "text-success-foreground" },
    { name: "Warning", className: "bg-warning", text: "text-warning-foreground" },
    { name: "Danger", className: "bg-danger", text: "text-danger-foreground" },
    { name: "Info", className: "bg-info", text: "text-info-foreground" },
  ];

  const spacing = ["1", "2", "3", "4", "5", "6", "8", "10", "12", "16"];
  const radius = [
    { label: "xs", className: "rounded-xs" },
    { label: "sm", className: "rounded-sm" },
    { label: "md", className: "rounded-md" },
    { label: "lg", className: "rounded-lg" },
    { label: "xl", className: "rounded-xl" },
    { label: "2xl", className: "rounded-2xl" },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ShowcaseFrame title="Palette sémantique" description="Les couleurs portent une intention, pas une fonction métier." code={'<div className="bg-surface text-foreground" />'} tokens={["--surface", "--primary", "--success"]}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {colors.map((color) => (
            <div key={color.name} className={cn("rounded-lg border border-border-subtle p-3 shadow-xs", color.className, color.text)}>
              <div className="mb-8 size-5 rounded-full border border-current/15 bg-current/15" aria-hidden="true" />
              <p className="text-label">{color.name}</p>
              <p className="mt-1 text-caption opacity-80">Sémantique</p>
            </div>
          ))}
        </div>
      </ShowcaseFrame>

      <ShowcaseFrame title="Typographie" description="Inter Variable, une hiérarchie courte et lisible." code={'<h2 className="text-h2">Titre de section</h2>'} tokens={["--ds-font-sans", "text-h1", "text-body-sm"]}>
        <div className="space-y-3">
          <p className="text-display">Display — HALAL ERP</p>
          <p className="text-h1">H1 — Un titre qui hiérarchise</p>
          <p className="text-h2">H2 — Une section précise</p>
          <p className="text-h3">H3 — Un sous-ensemble</p>
          <p className="text-body-sm">Body Small — Texte d’accompagnement clair et calme.</p>
          <p className="text-overline">Overline — Contexte</p>
        </div>
      </ShowcaseFrame>

      <ShowcaseFrame title="Échelle d’espacement" description="L’interface utilise une cadence de 4 px, sans valeurs arbitraires." code={'<div className="gap-4 p-6" />'} tokens={["--ds-space-1", "--ds-space-4", "--ds-space-16"]}>
        <div className="space-y-3">
          {spacing.map((space) => (
            <div key={space} className="flex items-center gap-3">
              <code className="w-20 text-caption">space-{space}</code>
              <div className="h-3 rounded-full bg-primary/80" style={{ width: `var(--ds-space-${space})` }} aria-label={`Espacement ${space}`} />
            </div>
          ))}
        </div>
      </ShowcaseFrame>

      <ShowcaseFrame title="Rayons, ombres et motion" description="Une élévation douce et des transitions brèves, utiles uniquement." code={'<Card className="rounded-xl shadow-sm transition-ui" />'} tokens={["--radius-lg", "--shadow-sm", "--ds-duration-standard"]}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-label text-muted-foreground">Radius</p>
            <div className="flex flex-wrap gap-2">
              {radius.map((item) => <span key={item.label} className={cn("border bg-surface px-3 py-2 text-caption", item.className)}>{item.label}</span>)}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-label text-muted-foreground">Élévation</p>
            <div className="flex flex-wrap gap-3">
              <span className="rounded-md bg-surface px-3 py-2 text-caption shadow-xs">xs</span>
              <span className="rounded-md bg-surface px-3 py-2 text-caption shadow-sm">sm</span>
              <span className="rounded-md bg-surface px-3 py-2 text-caption shadow-md">md</span>
            </div>
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-2 text-caption text-muted-foreground">
            <Badge variant="neutral" appearance="soft">120 ms · rapide</Badge>
            <Badge variant="neutral" appearance="soft">150 ms · standard</Badge>
            <Badge variant="neutral" appearance="soft">180 ms · ample</Badge>
          </div>
        </div>
      </ShowcaseFrame>
    </div>
  );
}

function ButtonsShowcase() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ShowcaseFrame title="Variantes" description="Une action principale par contexte, avec un état visuel explicite." code={'<Button variant="primary">Enregistrer</Button>'} tokens={["--primary", "--success", "--destructive"]}>
        <div className="flex flex-wrap gap-3">
          {buttonExamples.map((button) => <Button key={button.variant} variant={button.variant}>{button.label}</Button>)}
        </div>
      </ShowcaseFrame>
      <ShowcaseFrame title="Tailles et états" description="Les mêmes comportements clavier, focus et chargement à chaque taille." code={'<Button loading loadingLabel="Enregistrement">Enregistrer</Button>'} tokens={["--ds-control-height-sm", "--ds-control-height-md", "--ds-opacity-disabled"]}>
        <div className="flex flex-wrap items-center gap-3">
          {buttonSizes.map((button) => <Button key={button.size} size={button.size} variant="outline">{button.label}</Button>)}
          <Button variant="primary" loading loadingLabel="Chargement de l’exemple">Chargement</Button>
          <Button variant="secondary" disabled>Désactivé</Button>
          <Tooltip>
            <TooltipTrigger asChild><Button variant="floating" size="icon" aria-label="Action flottante"><Sparkles aria-hidden="true" /></Button></TooltipTrigger>
            <TooltipContent>Action flottante</TooltipContent>
          </Tooltip>
        </div>
      </ShowcaseFrame>
    </div>
  );
}

function InputsShowcase() {
  const [search, setSearch] = React.useState("");
  const [comboboxValue, setComboboxValue] = React.useState("surface");
  const [otp, setOtp] = React.useState("");

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ShowcaseFrame title="Champs de saisie" description="Même hauteur, même focus visible et même rythme vertical." code={'<Input aria-invalid={false} placeholder="Libellé" />'} tokens={["--input", "--ring", "--ds-control-height-md"]}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="showcase-input">Input</Label><Input id="showcase-input" placeholder="Nom du composant" /></div>
          <div className="space-y-2"><Label htmlFor="showcase-date">Date</Label><Input id="showcase-date" type="date" /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="showcase-textarea">Textarea</Label><Textarea id="showcase-textarea" placeholder="Description de démonstration" /></div>
          <div className="space-y-2"><Label>Select</Label><Select defaultValue="standard"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="compact">Compact</SelectItem><SelectItem value="standard">Standard</SelectItem><SelectItem value="comfortable">Confortable</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Combobox</Label><Combobox options={comboboxOptions} value={comboboxValue} onValueChange={setComboboxValue} /></div>
        </div>
      </ShowcaseFrame>
      <ShowcaseFrame title="Recherche, OTP et états" description="Les états négatifs sont accompagnés d’un message, jamais de couleur seule." code={'<SearchInput value={query} onClear={() => setQuery("")} />'} tokens={["--surface-hover", "--destructive", "--ds-opacity-disabled"]}>
        <div className="space-y-4">
          <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch("")} placeholder="Rechercher un composant" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="showcase-invalid">État invalide</Label><Input id="showcase-invalid" aria-invalid="true" defaultValue="invalide" /><p className="text-caption text-destructive">Le libellé doit être précisé.</p></div>
            <div className="space-y-2"><Label htmlFor="showcase-disabled">État désactivé</Label><Input id="showcase-disabled" disabled value="Indisponible" readOnly /></div>
          </div>
          <div className="space-y-2"><Label>OTP</Label><InputOTP maxLength={6} value={otp} onChange={setOtp}><InputOTPGroup>{[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot key={index} index={index} />)}</InputOTPGroup></InputOTP></div>
        </div>
      </ShowcaseFrame>
    </div>
  );
}

function CardsShowcase() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cardExamples.map((card) => (
        <ShowcaseFrame key={card.variant} title={card.title} description={card.description} code={`<Card variant="${card.variant}" />`} tokens={["--surface", "--border", `Card.${card.variant}`]}>
          <Card variant={card.variant} className="min-h-28">
            <CardHeader className="p-4"><CardTitle className="text-h4">{card.title}</CardTitle><CardDescription>Une carte de référence, sans donnée métier.</CardDescription></CardHeader>
          </Card>
        </ShowcaseFrame>
      ))}
    </div>
  );
}

function BadgesShowcase() {
  return (
    <ShowcaseFrame title="Variantes de statut" description="Les badges complètent un texte explicite et ne portent jamais seuls une information critique." code={'<Badge variant="success" appearance="soft">Validé</Badge>'} tokens={["--success", "--warning", "--destructive", "--info"]}>
      <div className="space-y-4">
        {badgeAppearances.map((appearance) => (
          <div key={appearance} className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-label text-muted-foreground">{appearance}</span>
            {badgeVariants.map((variant) => <Badge key={variant} variant={variant} appearance={appearance}>{variant}</Badge>)}
          </div>
        ))}
      </div>
    </ShowcaseFrame>
  );
}

function DialogsShowcase() {
  return (
    <ShowcaseFrame title="Overlays" description="Les primitives Radix gardent le focus, l’échappement et la navigation clavier cohérents." code={'<Dialog><DialogTrigger asChild><Button>Ouvrir</Button></DialogTrigger></Dialog>'} tokens={["--overlay", "--surface-elevated", "--shadow-lg"]}>
      <div className="flex flex-wrap gap-3">
        <Dialog><DialogTrigger asChild><Button variant="outline">Dialog</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Dialog de démonstration</DialogTitle><DialogDescription>Un contenu neutre pour valider le comportement du composant.</DialogDescription></DialogHeader><DialogFooter><Button variant="primary">Confirmer</Button></DialogFooter></DialogContent></Dialog>
        <Drawer><DrawerTrigger asChild><Button variant="outline">Drawer</Button></DrawerTrigger><DrawerContent><DrawerHeader><DrawerTitle>Drawer de démonstration</DrawerTitle><DrawerDescription>Une surface adaptée aux petits écrans.</DrawerDescription></DrawerHeader><DrawerFooter><DrawerClose asChild><Button variant="outline">Fermer</Button></DrawerClose></DrawerFooter></DrawerContent></Drawer>
        <Popover><PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger><PopoverContent><p className="font-medium">Information contextuelle</p><p className="mt-1 text-caption">Une aide courte, au plus près de l’action.</p></PopoverContent></Popover>
        <DropdownPreview />
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Afficher une aide"><Info aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>Tooltip accessible</TooltipContent></Tooltip>
        <AlertDialog><AlertDialogTrigger asChild><Button variant="danger">Alert Dialog</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirmer la démonstration</AlertDialogTitle><AlertDialogDescription>Cette action n’a aucun effet sur les données de l’ERP.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction>Continuer</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </div>
    </ShowcaseFrame>
  );
}

function DropdownPreview() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline">Dropdown</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem><Check aria-hidden="true" />Option active</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem><Settings2 aria-hidden="true" />Préférences</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TablesShowcase() {
  return (
    <ShowcaseFrame title="DataTable" description="Tri, recherche, sélection, pagination et comportement responsive font partie de la même primitive." code={'<DataTable data={rows} columns={columns} selectable pageSize={4} />'} tokens={["--surface", "--surface-hover", "--border", "--ds-space-4"]}>
      <DataTable
        data={demoRows}
        columns={tableColumns}
        getRowId={(row) => row.id}
        getRowSearchText={(row) => `${row.component} ${row.family} ${row.state}`}
        selectable
        pageSize={4}
        density="comfortable"
        searchPlaceholder="Rechercher une démonstration"
        toolbar={<Badge variant="info" appearance="soft">Données fictives</Badge>}
        emptyState="Aucun composant ne correspond à la recherche."
      />
    </ShowcaseFrame>
  );
}

function NavigationShowcase() {
  const [commandOpen, setCommandOpen] = React.useState(false);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
      <ShowcaseFrame title="Shell et navigation" description="Une démonstration statique du contrat visuel : aucune navigation métier n’est appelée." code={'<Tabs defaultValue="overview"><TabsList>…</TabsList></Tabs>'} tokens={["--sidebar", "--surface", "--border", "--surface-hover"]}>
        <div className="overflow-hidden rounded-xl border bg-surface-sunken">
          <div className="flex min-h-72">
            <aside className="hidden w-44 shrink-0 border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground sm:block">
              <div className="mb-5 flex items-center gap-2 px-2 text-label"><Sparkles className="size-4 text-gold" />HALAL ERP</div>
              {["Pilotage", "Ressources", "Mobilité"].map((item, index) => <div key={item} className={cn("mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-caption", index === 0 ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75")}><LayoutDashboard className="size-3.5" />{item}</div>)}
            </aside>
            <div className="min-w-0 flex-1 p-3 sm:p-4">
              <div className="flex items-center gap-2 border-b border-border pb-3 text-caption text-muted-foreground"><span>Centre de pilotage</span><ChevronRight className="size-3" /><span className="truncate text-foreground">Références</span><Button type="button" size="icon-sm" variant="ghost" className="ml-auto" aria-label="Ouvrir les notifications de démonstration"><Bell aria-hidden="true" /></Button></div>
              <div className="mt-4 space-y-4"><SearchInput placeholder="Recherche universelle" /><Tabs defaultValue="overview"><TabsList><TabsTrigger value="overview">Vue d’ensemble</TabsTrigger><TabsTrigger value="activity">Activité</TabsTrigger></TabsList><TabsContent value="overview" className="text-caption text-muted-foreground">Les onglets partagent une seule convention de focus et d’état actif.</TabsContent><TabsContent value="activity" className="text-caption text-muted-foreground">Aucune donnée ERP n’est chargée.</TabsContent></Tabs></div>
            </div>
          </div>
        </div>
      </ShowcaseFrame>
      <ShowcaseFrame title="Command palette" description="Clavier et catégories avec des actions fictives uniquement." code={'<CommandDialog open={open} onOpenChange={setOpen}>…</CommandDialog>'} tokens={["--popover", "--surface-hover", "--shadow-lg"]}>
        <div className="space-y-3"><Button type="button" variant="primary" onClick={() => setCommandOpen(true)}><Search aria-hidden="true" />Ouvrir la palette <kbd className="rounded border border-primary-foreground/30 px-1.5 py-0.5 text-caption">Ctrl K</kbd></Button><p className="text-caption">Cette palette est isolée : ses entrées ne déclenchent aucune action métier.</p></div>
        <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}><CommandInput placeholder="Rechercher une action de démonstration" /><CommandList><CommandEmpty>Aucune démo trouvée.</CommandEmpty><CommandGroup heading="Navigation"><CommandItem onSelect={() => setCommandOpen(false)}><LayoutDashboard />Vue d’ensemble<CommandShortcut>G D</CommandShortcut></CommandItem><CommandItem onSelect={() => setCommandOpen(false)}><Palette />Tokens HDL<CommandShortcut>G T</CommandShortcut></CommandItem></CommandGroup><CommandGroup heading="Actions"><CommandItem onSelect={() => setCommandOpen(false)}><Sparkles />Créer une démo<CommandShortcut>⌘ N</CommandShortcut></CommandItem></CommandGroup></CommandList></CommandDialog>
      </ShowcaseFrame>
    </div>
  );
}

function FeedbackShowcase() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ShowcaseFrame title="Notifications et bannière" description="Chaque message donne un contexte et une action, sans utiliser la couleur seule." code={'toast.success("Exemple enregistré")'} tokens={["--info", "--warning", "--success"]}>
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-info/20 bg-info/10 p-3 text-body-sm"><Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" /><span><strong className="text-foreground">Information.</strong> Cette bannière utilise uniquement un texte de démonstration.</span></div>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="success" onClick={() => toast.success("Exemple de succès", { description: "Aucune donnée n’a été modifiée." })}>Toast succès</Button><Button type="button" variant="outline" onClick={() => toast.message("Message de démonstration", { description: "Le système de toast est déjà monté dans le shell." })}>Toast neutre</Button></div>
        </div>
      </ShowcaseFrame>
      <ShowcaseFrame title="Vide, chargement et skeleton" description="Les états de récupération restent explicites avant que des données soient disponibles." code={'<Skeleton className="h-8 w-full" />'} tokens={["--primary", "--surface-sunken", "--ds-opacity-subtle"]}>
        <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-lg border border-dashed p-4 text-center"><FileText className="mx-auto size-5 text-muted-foreground" aria-hidden="true" /><p className="mt-2 text-body-sm font-medium">Aucun élément</p><p className="mt-1 text-caption">Un état vide explique ce qui manque.</p></div><div className="space-y-3 rounded-lg border p-4"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-4/5" /><Progress value={64} aria-label="Exemple de progression à 64 %" /></div></div>
      </ShowcaseFrame>
    </div>
  );
}

function ChartsShowcase() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ShowcaseFrame title="Bar chart" description="Données fictives, couleurs HDL et tooltip commun." code={'<BarChart data={demoData}><Bar dataKey="activity" /></BarChart>'} tokens={["--primary", "--success", "--warning"]}>
        <ChartContainer config={chartConfig} className="aspect-[16/8] min-h-52"><BarChart data={chartData}><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="activity" fill="var(--color-activity)" radius={6} /><Bar dataKey="quality" fill="var(--color-quality)" radius={6} /></BarChart></ChartContainer>
      </ShowcaseFrame>
      <ShowcaseFrame title="Area et line charts" description="Courbes réservées aux évolutions et jamais employées sans légende ou valeur lisible." code={'<AreaChart data={demoData}><Area dataKey="quality" /></AreaChart>'} tokens={["--primary", "--info", "--surface"]}>
        <ChartContainer config={chartConfig} className="aspect-[16/8] min-h-52"><AreaChart data={chartData}><defs><linearGradient id="showcase-area" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="var(--color-quality)" stopOpacity={0.45} /><stop offset="95%" stopColor="var(--color-quality)" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="quality" stroke="var(--color-quality)" fill="url(#showcase-area)" strokeWidth={2} /></AreaChart></ChartContainer>
        <ChartContainer config={chartConfig} className="mt-4 aspect-[16/6] min-h-32"><LineChart data={chartData}><XAxis dataKey="label" hide /><ChartTooltip content={<ChartTooltipContent />} /><Line type="monotone" dataKey="attention" stroke="var(--color-attention)" strokeWidth={2} dot={false} /></LineChart></ChartContainer>
      </ShowcaseFrame>
      <ShowcaseFrame title="Pie chart" description="Répartition limitée à quelques catégories, toujours accompagnée de valeurs accessibles." code={'<PieChart><Pie data={demoData} dataKey="value" /></PieChart>'} tokens={["--primary", "--success", "--warning", "--info"]} className="xl:col-span-2">
        <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_15rem]"><ChartContainer config={chartConfig} className="aspect-[16/7] min-h-52"><PieChart><ChartTooltip content={<ChartTooltipContent nameKey="name" />} /><Pie data={pieData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3}>{pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie></PieChart></ChartContainer><ul className="space-y-2">{pieData.map((entry) => <li key={entry.name} className="flex items-center justify-between text-body-sm"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />{entry.name}</span><span className="font-medium tabular-nums">{entry.value} %</span></li>)}</ul></div>
      </ShowcaseFrame>
    </div>
  );
}

function FormsShowcase() {
  const [status, setStatus] = React.useState<"idle" | "error" | "success">("idle");

  const submitDemo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setStatus(formData.get("label") ? "success" : "error");
  };

  return (
    <ShowcaseFrame title="Formulaire de démonstration" description="La validation présentée ici est locale au Showcase et ne contacte aucun service métier." code={'<form onSubmit={submitDemo}>…</form>'} tokens={["--ring", "--destructive", "--success", "--ds-space-4"]}>
      <form className="grid max-w-2xl gap-4" onSubmit={submitDemo} noValidate>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="form-label">Libellé *</Label><Input id="form-label" name="label" placeholder="Ex. Carte KPI" aria-invalid={status === "error"} /><p className={cn("text-caption text-destructive", status !== "error" && "invisible")}>Ce champ est requis pour la démo.</p></div><div className="space-y-2"><Label htmlFor="form-category">Famille</Label><Input id="form-category" name="category" placeholder="Fondation" /></div></div>
        <div className="space-y-2"><Label htmlFor="form-notes">Note</Label><Textarea id="form-notes" name="notes" placeholder="Une note strictement fictive." /></div>
        {status === "success" ? <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success/10 px-3 py-2 text-body-sm text-success"><Check className="mt-0.5 size-4" aria-hidden="true" />Démonstration validée localement.</div> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary">Valider la démo</Button><Button type="button" variant="outline" loading>État loading</Button></div>
      </form>
    </ShowcaseFrame>
  );
}

function MotionShowcase() {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <ShowcaseFrame title="Motion HDL" description="Les transitions sont courtes, déclenchées par une action et respectent les préférences de mouvement réduit." code={'<div className="animate-slide-in transition-ui" />'} tokens={["--ds-duration-fast", "--ds-duration-standard", "--ds-duration-slow"]}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "Fade", className: "animate-fade-in" }, { label: "Scale", className: "animate-scale-in" }, { label: "Slide", className: "animate-slide-in" }].map((motion) => <div key={motion.label} className={cn("rounded-lg border bg-surface p-4 text-body-sm shadow-xs", motion.className)}>{motion.label}<p className="mt-1 text-caption">Déclenchée au rendu</p></div>)}
        <div className="rounded-lg border bg-surface p-4"><Button type="button" variant="ghost" size="sm" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>Collapse</Button><div className={cn("grid transition-[grid-template-rows,opacity] transition-ui", collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] animate-collapse-in opacity-100")}><div className="overflow-hidden"><p className="pt-2 text-caption">Contenu repliable sans animation permanente.</p></div></div></div>
      </div>
    </ShowcaseFrame>
  );
}

function IconsShowcase() {
  return (
    <ShowcaseFrame title="Galerie Lucide" description="Même système d’icônes, tailles cohérentes et libellé accessible pour chaque action." code={'<Settings2 className="size-4" aria-hidden="true" />'} tokens={["--foreground", "--muted-foreground", "--primary"]}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {iconExamples.map(({ name, Icon }) => <div key={name} className="rounded-lg border bg-surface p-3 text-center"><Icon className="mx-auto size-5 text-primary" aria-hidden="true" /><p className="mt-2 text-caption text-foreground">{name}</p></div>)}
      </div>
    </ShowcaseFrame>
  );
}

function AccessibilityShowcase() {
  return (
    <ShowcaseFrame title="Contraste, focus et clavier" description="Le style d’état ne dépend jamais d’une couleur seule et le focus reste visible dans toutes les primitives." code={'<Button aria-label="Enregistrer"><Check /></Button>'} tokens={["--ring", "--text-primary", "--ds-opacity-disabled"]}>
      <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-lg border p-4"><p className="text-label">Focus visible</p><Button className="mt-3" variant="outline">Tab vers moi</Button><p className="mt-2 text-caption">Utilisez Tab pour vérifier l’anneau de focus.</p></div><div className="rounded-lg border p-4"><p className="text-label">État désactivé</p><Button className="mt-3" disabled>Désactivé</Button><p className="mt-2 text-caption">L’état est distinct et annoncé nativement.</p></div><div className="rounded-lg border p-4"><p className="text-label">Statut explicite</p><div className="mt-3 flex items-center gap-2"><CircleAlert className="size-4 text-warning" aria-hidden="true" /><span className="text-body-sm">Attention requise</span></div><p className="mt-2 text-caption">Texte + icône + couleur, jamais la couleur seule.</p></div></div>
    </ShowcaseFrame>
  );
}

function DesignShowcasePage() {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="mx-auto w-full max-w-(--ds-content-max-width) space-y-8 p-4 sm:p-6 lg:p-8">
        <PageHeader eyebrow="HDL 1.1 · Référence interne" title="Design Showcase" description="La bibliothèque de référence du HALAL Design Language. Toutes les données et interactions visibles ici sont fictives." actions={<Badge variant="premium" appearance="soft">Développement uniquement</Badge>} />

        <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-24">
            <nav aria-label="Sections du Design Showcase" className="overflow-x-auto rounded-xl border bg-surface p-2 shadow-xs lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
              <div className="flex gap-1 lg:flex-col">
                {showcaseNavigation.map(({ id, label, Icon }) => <a key={id} href={`#${id}`} className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-body-sm text-muted-foreground transition-[background-color,color] transition-ui-fast hover:bg-surface-hover hover:text-foreground focus-visible:bg-surface-hover focus-visible:text-foreground"><Icon className="size-4" aria-hidden="true" />{label}</a>)}
              </div>
            </nav>
          </aside>

          <main className="min-w-0 space-y-12 pb-12" aria-label="Démonstrations du HALAL Design Language">
            <ShowcaseSection id="foundations" eyebrow="01 · Foundations" title="Les fondations HDL" description="Tokens, rythme, contraste et mouvements forment le socle commun de toutes les interfaces HALAL ERP."><FoundationsShowcase /></ShowcaseSection>
            <ShowcaseSection id="buttons" eyebrow="02 · Buttons" title="Actions" description="Des boutons cohérents dans chaque contexte, avec des états utilisables au clavier."><ButtonsShowcase /></ShowcaseSection>
            <ShowcaseSection id="inputs" eyebrow="03 · Inputs" title="Champs et sélection" description="Des champs contrôlés, lisibles et homogènes pour toutes les futures interfaces."><InputsShowcase /></ShowcaseSection>
            <ShowcaseSection id="cards" eyebrow="04 · Cards" title="Surfaces de contenu" description="Les cartes organisent l’information avant de la décorer."><CardsShowcase /></ShowcaseSection>
            <ShowcaseSection id="badges" eyebrow="05 · Badges" title="Statuts" description="Des signes compacts, toujours accompagnés d’un libellé explicite."><BadgesShowcase /></ShowcaseSection>
            <ShowcaseSection id="dialogs" eyebrow="06 · Dialogs" title="Overlays et aides contextuelles" description="Des couches accessibles et cohérentes, de la confirmation à l’aide ponctuelle."><DialogsShowcase /></ShowcaseSection>
            <ShowcaseSection id="tables" eyebrow="07 · Tables" title="Données structurées" description="Une table de démonstration complète, indépendante de toute donnée métier."><TablesShowcase /></ShowcaseSection>
            <ShowcaseSection id="navigation" eyebrow="08 · Navigation" title="Repères et commandes" description="La navigation fait partie du produit, sans devenir une distraction."><NavigationShowcase /></ShowcaseSection>
            <ShowcaseSection id="feedback" eyebrow="09 · Feedback" title="Retours système" description="Chargement, vide, progression et notifications conservent toujours un sens explicite."><FeedbackShowcase /></ShowcaseSection>
            <ShowcaseSection id="charts" eyebrow="10 · Charts" title="Visualisation" description="Des graphiques HDL sur des données fictives, jamais sur le journal opérationnel."><ChartsShowcase /></ShowcaseSection>
            <ShowcaseSection id="forms" eyebrow="11 · Forms" title="Validation locale" description="Un exemple autonome de validation et de retour utilisateur."><FormsShowcase /></ShowcaseSection>
            <ShowcaseSection id="motion" eyebrow="12 · Motion" title="Mouvement utile" description="Les animations expliquent une transition ; elles ne décorent pas l’écran."><MotionShowcase /></ShowcaseSection>
            <ShowcaseSection id="icons" eyebrow="13 · Icons" title="Icônes Lucide" description="Une seule bibliothèque, des tailles répétables et un alignement constant."><IconsShowcase /></ShowcaseSection>
            <ShowcaseSection id="accessibility" eyebrow="14 · Accessibility" title="Accessibilité intégrée" description="Focus, contraste, statuts et interactions clavier sont vérifiés dans la fondation."><AccessibilityShowcase /></ShowcaseSection>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export { DesignShowcasePage };
