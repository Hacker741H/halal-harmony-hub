import type { NotionDatabaseMapping } from "./types";

/**
 * Sync adapter — architecture only.
 *
 * Once a Notion API token is configured in `company_settings`, an importer
 * will call `upsertFromNotion` with rows already parsed from the Notion API.
 * The adapter is responsible for:
 *   1. Matching each incoming row to an existing ERP record via `notion_page_id`.
 *   2. Updating or inserting the row.
 *   3. Stamping `notion_last_synced_at`.
 *
 * This module is intentionally NOT wired to Supabase yet — the schema is ready
 * and the mapping declarations exist, so plugging in the real Notion client is
 * a self-contained future change.
 */
export interface NotionRow {
  notion_page_id: string;
  notion_workspace_id?: string;
  fields: Record<string, unknown>;
}

export interface SyncResult {
  moduleKey: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ notion_page_id: string; message: string }>;
}

export async function upsertFromNotion(
  _mapping: NotionDatabaseMapping,
  _rows: NotionRow[],
): Promise<SyncResult> {
  // Placeholder: the real implementation will be added when the Notion
  // integration is enabled from the Paramètres page.
  return {
    moduleKey: _mapping.moduleKey,
    inserted: 0,
    updated: 0,
    skipped: _rows.length,
    errors: [],
  };
}
