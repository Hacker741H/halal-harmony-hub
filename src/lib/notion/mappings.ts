import type { NotionDatabaseMapping } from "./types";

/**
 * Declarative mapping between Notion databases and local ERP tables.
 * The Notion property names below are the DEFAULT names — administrators
 * will be able to override each one from the Paramètres → Notion page.
 *
 * No API call is made from this file. It is consumed by the (future)
 * importer in `sync-adapter.ts`.
 */
export const NOTION_MAPPINGS: NotionDatabaseMapping[] = [
  {
    moduleKey: "employees",
    label: "Employés",
    table: "employees",
    properties: [
      { column: "matricule", notionProperty: "Matricule", type: "rich_text" },
      { column: "nom", notionProperty: "Nom", type: "title" },
      { column: "prenom", notionProperty: "Prénom", type: "rich_text" },
      { column: "poste", notionProperty: "Poste", type: "select" },
      { column: "telephone", notionProperty: "Téléphone", type: "phone_number" },
      { column: "email", notionProperty: "Email", type: "email" },
      { column: "date_embauche", notionProperty: "Date d'embauche", type: "date" },
      { column: "salaire_base", notionProperty: "Salaire", type: "number" },
      { column: "statut", notionProperty: "Statut", type: "status" },
    ],
  },
  {
    moduleKey: "drivers",
    label: "Chauffeurs",
    table: "drivers",
    properties: [
      { column: "numero_permis", notionProperty: "N° permis", type: "rich_text" },
      { column: "categorie_permis", notionProperty: "Catégorie", type: "select" },
      { column: "date_expiration_permis", notionProperty: "Expiration permis", type: "date" },
      { column: "statut", notionProperty: "Statut", type: "status" },
    ],
  },
  {
    moduleKey: "motorcycles",
    label: "Motos",
    table: "motorcycles",
    properties: [
      { column: "immatriculation", notionProperty: "Immatriculation", type: "title" },
      { column: "marque", notionProperty: "Marque", type: "select" },
      { column: "modele", notionProperty: "Modèle", type: "rich_text" },
      { column: "annee", notionProperty: "Année", type: "number" },
      { column: "kilometrage", notionProperty: "Kilométrage", type: "number" },
      { column: "statut", notionProperty: "Statut", type: "status" },
    ],
  },
  {
    moduleKey: "vehicles",
    label: "Véhicules",
    table: "vehicles",
    properties: [
      { column: "immatriculation", notionProperty: "Immatriculation", type: "title" },
      { column: "marque", notionProperty: "Marque", type: "select" },
      { column: "modele", notionProperty: "Modèle", type: "rich_text" },
      { column: "type", notionProperty: "Type", type: "select" },
      { column: "annee", notionProperty: "Année", type: "number" },
      { column: "kilometrage", notionProperty: "Kilométrage", type: "number" },
      { column: "statut", notionProperty: "Statut", type: "status" },
    ],
  },
  {
    moduleKey: "farms",
    label: "Exploitations",
    table: "farms",
    properties: [
      { column: "nom", notionProperty: "Nom", type: "title" },
      { column: "localisation", notionProperty: "Localisation", type: "rich_text" },
      { column: "superficie_ha", notionProperty: "Superficie (ha)", type: "number" },
      { column: "type_culture", notionProperty: "Culture", type: "select" },
      { column: "statut", notionProperty: "Statut", type: "status" },
    ],
  },
  {
    moduleKey: "contracts",
    label: "Contrats",
    table: "contracts",
    properties: [
      { column: "reference", notionProperty: "Référence", type: "title" },
      { column: "type", notionProperty: "Type", type: "select" },
      { column: "partie", notionProperty: "Partie", type: "rich_text" },
      { column: "date_debut", notionProperty: "Début", type: "date" },
      { column: "date_fin", notionProperty: "Fin", type: "date" },
      { column: "montant", notionProperty: "Montant", type: "number" },
      { column: "statut", notionProperty: "Statut", type: "status" },
    ],
  },
  {
    moduleKey: "expenses",
    label: "Dépenses",
    table: "expenses",
    properties: [
      { column: "date", notionProperty: "Date", type: "date" },
      { column: "categorie", notionProperty: "Catégorie", type: "select" },
      { column: "montant", notionProperty: "Montant", type: "number" },
      { column: "description", notionProperty: "Description", type: "rich_text" },
    ],
  },
  {
    moduleKey: "revenues",
    label: "Recettes",
    table: "revenues",
    properties: [
      { column: "date", notionProperty: "Date", type: "date" },
      { column: "source", notionProperty: "Source", type: "select" },
      { column: "montant", notionProperty: "Montant", type: "number" },
      { column: "description", notionProperty: "Description", type: "rich_text" },
    ],
  },
  {
    moduleKey: "payments",
    label: "Versements",
    table: "payments",
    properties: [
      { column: "date", notionProperty: "Date", type: "date" },
      { column: "type", notionProperty: "Type", type: "select" },
      { column: "montant", notionProperty: "Montant", type: "number" },
      { column: "methode", notionProperty: "Méthode", type: "select" },
      { column: "reference", notionProperty: "Référence", type: "rich_text" },
    ],
  },
  {
    moduleKey: "inventory_items",
    label: "Stock",
    table: "inventory_items",
    properties: [
      { column: "sku", notionProperty: "SKU", type: "rich_text" },
      { column: "nom", notionProperty: "Nom", type: "title" },
      { column: "categorie", notionProperty: "Catégorie", type: "select" },
      { column: "unite", notionProperty: "Unité", type: "select" },
      { column: "stock_actuel", notionProperty: "Stock", type: "number" },
      { column: "seuil_alerte", notionProperty: "Seuil d'alerte", type: "number" },
    ],
  },
  {
    moduleKey: "documents",
    label: "Documents",
    table: "documents",
    properties: [
      { column: "nom", notionProperty: "Nom", type: "title" },
      { column: "type", notionProperty: "Type", type: "select" },
      { column: "url", notionProperty: "Fichier", type: "url" },
      { column: "date_emission", notionProperty: "Émission", type: "date" },
      { column: "date_expiration", notionProperty: "Expiration", type: "date" },
    ],
  },
  {
    moduleKey: "maintenances",
    label: "Entretiens",
    table: "maintenances",
    properties: [
      { column: "date", notionProperty: "Date", type: "date" },
      { column: "type", notionProperty: "Type", type: "select" },
      { column: "cout", notionProperty: "Coût", type: "number" },
      { column: "kilometrage", notionProperty: "Kilométrage", type: "number" },
      { column: "prestataire", notionProperty: "Prestataire", type: "rich_text" },
    ],
  },
];

export function getMapping(moduleKey: string): NotionDatabaseMapping | undefined {
  return NOTION_MAPPINGS.find((m) => m.moduleKey === moduleKey);
}
