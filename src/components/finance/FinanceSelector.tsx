import { ArrowDownCircle, ArrowUpCircle, Landmark, Repeat } from "lucide-react";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type FinanceType = "REVENUE" | "EXPENSE" | "DEPOSIT" | "TRANSFER";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (type: FinanceType) => void;
};

const cards = [
  { type: "REVENUE" as const, title: "Recette", description: "Enregistrer une entrée d'argent.", icon: ArrowUpCircle, tone: "text-success bg-success/10" },
  { type: "EXPENSE" as const, title: "Dépense", description: "Enregistrer une sortie d'argent.", icon: ArrowDownCircle, tone: "text-destructive bg-destructive/10" },
  { type: "DEPOSIT" as const, title: "Versement", description: "Ajouter des fonds dans un wallet.", icon: Landmark, tone: "text-info bg-info/10" },
  { type: "TRANSFER" as const, title: "Transfert", description: "Déplacer de l'argent entre deux wallets.", icon: Repeat, tone: "text-primary bg-primary/10" },
];

export function FinanceSelector({ open, onOpenChange, onSelect }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Nouvelle opération</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.type}
                variant="section"
                role="button"
                tabIndex={0}
                onClick={() => onSelect(item.type)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(item.type);
                }}
                className="cursor-pointer border-border/75 transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:bg-surface-hover hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CardContent className="flex items-start gap-4 p-5">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.tone}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
