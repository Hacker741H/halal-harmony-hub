import {
  ArrowDownCircle,
  ArrowUpCircle,
  Repeat,
  Landmark,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Card } from "@/components/ui/card";

export type FinanceType =
  | "REVENUE"
  | "EXPENSE"
  | "DEPOSIT"
  | "TRANSFER";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (type: FinanceType) => void;
};

const cards = [
  {
    type: "REVENUE" as const,
    title: "Recette",
    description:
      "Enregistrer une entrée d'argent.",
    icon: ArrowUpCircle,
    color:
      "border-green-500 hover:bg-green-50",
  },

  {
    type: "EXPENSE" as const,
    title: "Dépense",
    description:
      "Enregistrer une sortie d'argent.",
    icon: ArrowDownCircle,
    color:
      "border-red-500 hover:bg-red-50",
  },

  {
    type: "DEPOSIT" as const,
    title: "Versement",
    description:
      "Ajouter des fonds dans un wallet.",
    icon: Landmark,
    color:
      "border-blue-500 hover:bg-blue-50",
  },

  {
    type: "TRANSFER" as const,
    title: "Transfert",
    description:
      "Déplacer de l'argent entre deux wallets.",
    icon: Repeat,
    color:
      "border-purple-500 hover:bg-purple-50",
  },
];

export function FinanceSelector({
  open,
  onOpenChange,
  onSelect,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-4xl">

        <DialogHeader>

          <DialogTitle className="text-2xl">
            Nouvelle opération
          </DialogTitle>

        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">

          {cards.map((item) => {
            const Icon = item.icon;

            return (
              <Card
                key={item.type}
                onClick={() =>
                  onSelect(item.type)
                }
                className={`cursor-pointer p-6 transition-all ${item.color}`}
              >
                <div className="flex items-start gap-4">

                  <Icon className="h-10 w-10" />

                  <div>

                    <h2 className="text-xl font-bold">
                      {item.title}
                    </h2>

                    <p className="mt-2 text-muted-foreground">
                      {item.description}
                    </p>

                  </div>

                </div>
              </Card>
            );
          })}

        </div>

      </DialogContent>
    </Dialog>
  );
}
