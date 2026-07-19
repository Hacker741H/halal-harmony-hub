// Notion synchronization types — architecture only, no API calls yet.
// Every ERP table carries `notion_page_id`, `notion_workspace_id`, and
// `notion_last_synced_at` columns so that a future importer can upsert
// records without changing the schema.

export type NotionPropertyType =
  | "title"
  | "rich_text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "relation"
  | "people"
  | "files";

export interface NotionPropertyMap {
  /** Local column name in Postgres. */
  column: string;
  /** Notion property name as it appears in the Notion database. */
  notionProperty: string;
  /** Notion property type — used later to parse values correctly. */
  type: NotionPropertyType;
  /** Optional transformer, applied after parsing. */
  transform?: (value: unknown) => unknown;
}

export interface NotionDatabaseMapping {
  /** Stable module key stored in `notion_database_mappings.module_key`. */
  moduleKey: string;
  /** Friendly French label. */
  label: string;
  /** Local Postgres table. */
  table: string;
  /** Property mappings. */
  properties: NotionPropertyMap[];
}
