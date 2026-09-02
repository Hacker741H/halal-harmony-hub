import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { useState } from "react";

import { InventoryCountsPanel } from "@/components/commerce/inventory-counts-panel";
import { StockTransfersPanel } from "@/components/commerce/stock-transfers-panel";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Inventaires et Transferts partagent déjà le même moteur de valorisation
 * (coût moyen pondéré) et le même contrôle d'accès par magasin -- rien dans
 * le code ne dépendait de leur séparation en deux destinations de menu.
 * Fusionnés ici en une seule route à onglets ; chaque onglet garde son
 * propre filtre, sa propre pagination et ses propres permissions
 * (inventory.counts.* / transfers.*), inchangées.
 */
export const Route = createFileRoute("/_authenticated/stock-operations/")({ component: StockOperationsPage });

function StockOperationsPage() {
  const [tab, setTab] = useState<"counts" | "transfers">("counts");

  return (
    <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
      <OperationalHero
        variant="deep"
        icon={ClipboardList}
        eyebrow="Commerce"
        title="Ajustements de stock"
        description="Comptages physiques et transferts entre magasins, réunis ici -- aucune écriture financière dans les deux cas."
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="counts">Inventaires</TabsTrigger>
          <TabsTrigger value="transfers">Transferts</TabsTrigger>
        </TabsList>
        <TabsContent value="counts" className="mt-6"><InventoryCountsPanel /></TabsContent>
        <TabsContent value="transfers" className="mt-6"><StockTransfersPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
