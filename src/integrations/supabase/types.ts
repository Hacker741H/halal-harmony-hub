export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type TransportMissionRow = {
  id: string; mission_number: string; status: string; client_id: string; vehicle_id: string | null; driver_id: string | null
  departure_location: string | null; destination_location: string | null; cargo_description: string | null; cargo_quantity: number | null; cargo_unit: string | null
  cargo_weight_kg: number | null; cargo_volume_m3: number | null; distance_km: number | null; planned_departure_at: string | null; planned_arrival_at: string | null
  actual_departure_at: string | null; actual_arrival_at: string | null; start_odometer: number | null; end_odometer: number | null; quoted_amount: number
  currency_code: string; reference: string | null; notes: string | null; overlap_exception_reason: string | null; close_exception_reason: string | null; cancellation_reason: string | null
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; closed_at: string | null; cancelled_at: string | null
}
type TransportBudgetLineRow = { id: string; mission_id: string; category: string; planned_amount: number; notes: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string }
type TransportExpenseRow = { id: string; mission_id: string; wallet_id: string; category: string; amount: number; expense_date: string; status: string; description: string | null; receipt_document_id: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; confirmed_at: string | null; cancelled_at: string | null }
type TransportInvoiceRow = { id: string; invoice_number: string; mission_id: string; client_id: string; status: string; issue_date: string | null; due_date: string | null; subtotal_amount: number; tax_rate: number; tax_amount: number; total_amount: number; notes: string | null; cancelled_reason: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; issued_at: string | null; cancelled_at: string | null }
type TransportPaymentRow = { id: string; invoice_id: string; mission_id: string; wallet_id: string; amount: number; payment_date: string; status: string; payment_kind: string; reference: string | null; notes: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; confirmed_at: string | null; cancelled_at: string | null }
type FieldWalletAssignmentRow = { id: string; user_id: string; wallet_id: string; assignment_type: string; label: string | null; is_active: boolean; assigned_by: string | null; assigned_at: string; revoked_at: string | null; created_at: string; updated_at: string }
type FieldReportRow = { id: string; report_number: string; report_type: string; period_start: string; period_end: string; status: string; notes: string | null; created_by: string; submitted_at: string | null; reviewed_at: string | null; reviewed_by: string | null; review_note: string | null; created_at: string; updated_at: string }
type FieldDeclarationRow = { id: string; report_id: string; declaration_type: string; status: string; amount: number; occurred_at: string; field_wallet_id: string; destination_wallet_id: string | null; category: string; description: string | null; reference: string | null; client_id: string | null; farm_id: string | null; inventory_item_id: string | null; document_id: string | null; client_submission_id: string | null; created_by: string; submitted_at: string | null; confirmed_at: string | null; confirmed_by: string | null; rejected_at: string | null; rejected_by: string | null; rejection_reason: string | null; created_at: string; updated_at: string }

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      business_finance_audit: {
        Row: {
          action: string
          after_value: Json | null
          before_value: Json | null
          created_at: string
          id: string
          operation_id: string | null
          performed_by: string | null
          source_id: string
          source_type: string
        }
        Insert: {
          action: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          operation_id?: string | null
          performed_by?: string | null
          source_id: string
          source_type: string
        }
        Update: {
          action?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          operation_id?: string | null
          performed_by?: string | null
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_finance_audit_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          adresse: string | null
          created_at: string
          devise: string
          id: string
          logo_url: string | null
          nom: string
          notification_daily_run_time: string
          notion_sync_enabled: boolean
          notion_workspace_id: string | null
          timezone: string
          updated_at: string
          vat_enabled: boolean
          vat_rate: number | null
        }
        Insert: {
          adresse?: string | null
          created_at?: string
          devise?: string
          id?: string
          logo_url?: string | null
          nom?: string
          notification_daily_run_time?: string
          notion_sync_enabled?: boolean
          notion_workspace_id?: string | null
          timezone?: string
          updated_at?: string
          vat_enabled?: boolean
          vat_rate?: number | null
        }
        Update: {
          adresse?: string | null
          created_at?: string
          devise?: string
          id?: string
          logo_url?: string | null
          nom?: string
          notification_daily_run_time?: string
          notion_sync_enabled?: boolean
          notion_workspace_id?: string | null
          timezone?: string
          updated_at?: string
          vat_enabled?: boolean
          vat_rate?: number | null
        }
        Relationships: []
      }
      client_identifier_validation_rules: {
        Row: {
          country_code: string
          created_at: string
          id: string
          identifier_type: string
          is_active: boolean
          label: string
          updated_at: string
          validation_pattern: string | null
        }
        Insert: {
          country_code?: string
          created_at?: string
          id?: string
          identifier_type: string
          is_active?: boolean
          label: string
          updated_at?: string
          validation_pattern?: string | null
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          identifier_type?: string
          is_active?: boolean
          label?: string
          updated_at?: string
          validation_pattern?: string | null
        }
        Relationships: []
      }
      transport_clients: {
        Row: {
          address: string | null
          archived_at: string | null
          archived_by: string | null
          city: string | null
          client_number: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country_code: string
          created_at: string
          created_by: string | null
          display_name: string
          email: string | null
          id: string
          kind: string
          legal_name: string | null
          merged_into_client_id: string | null
          notes: string | null
          registration_identifier_type: string | null
          registration_identifier_value: string | null
          status: string
          telephone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          archived_by?: string | null
          city?: string | null
          client_number: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          display_name: string
          email?: string | null
          id?: string
          kind?: string
          legal_name?: string | null
          merged_into_client_id?: string | null
          notes?: string | null
          registration_identifier_type?: string | null
          registration_identifier_value?: string | null
          status?: string
          telephone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          archived_by?: string | null
          city?: string | null
          client_number?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          email?: string | null
          id?: string
          kind?: string
          legal_name?: string | null
          merged_into_client_id?: string | null
          notes?: string | null
          registration_identifier_type?: string | null
          registration_identifier_value?: string | null
          status?: string
          telephone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transport_clients_merged_into_client_id_fkey"
            columns: ["merged_into_client_id"]
            isOneToOne: false
            referencedRelation: "transport_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_driver_links: {
        Row: {
          contract_id: string
          created_at: string
          driver_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          driver_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          driver_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_driver_links_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_driver_links_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_employee_links: {
        Row: {
          contract_id: string
          created_at: string
          employee_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          employee_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_employee_links_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_employee_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_farm_links: {
        Row: {
          contract_id: string
          created_at: string
          farm_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          farm_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          farm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_farm_links_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_farm_links_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_motorcycle_links: {
        Row: {
          contract_id: string
          created_at: string
          motorcycle_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          motorcycle_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          motorcycle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_motorcycle_links_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_motorcycle_links_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_vehicle_links: {
        Row: {
          contract_id: string
          created_at: string
          vehicle_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          vehicle_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_vehicle_links_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_vehicle_links_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          created_at: string
          date_debut: string | null
          date_fin: string | null
          description: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          montant: number | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          partie: string | null
          reference: string | null
          statut: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["entity_kind"] | null
          id?: string
          montant?: number | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          partie?: string | null
          reference?: string | null
          statut?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["entity_kind"] | null
          id?: string
          montant?: number | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          partie?: string | null
          reference?: string | null
          statut?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      document_contract_links: {
        Row: {
          contract_id: string
          created_at: string
          document_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          document_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_contract_links_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_contract_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_transport_client_links: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          document_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          document_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_transport_client_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "transport_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_transport_client_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_driver_links: {
        Row: {
          created_at: string
          document_id: string
          driver_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          driver_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          driver_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_driver_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_driver_links_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      document_employee_links: {
        Row: {
          created_at: string
          document_id: string
          employee_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          employee_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_employee_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_employee_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      document_farm_links: {
        Row: {
          created_at: string
          document_id: string
          farm_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          farm_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          farm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_farm_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_farm_links_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      document_motorcycle_links: {
        Row: {
          created_at: string
          document_id: string
          motorcycle_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          motorcycle_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          motorcycle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_motorcycle_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_motorcycle_links_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_motorcycle_maintenance_links: {
        Row: {
          created_at: string
          document_id: string
          motorcycle_maintenance_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          motorcycle_maintenance_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          motorcycle_maintenance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_motorcycle_maintenance__motorcycle_maintenance_id_fkey"
            columns: ["motorcycle_maintenance_id"]
            isOneToOne: false
            referencedRelation: "motorcycle_maintenances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_motorcycle_maintenance_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_vehicle_links: {
        Row: {
          created_at: string
          document_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_vehicle_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_vehicle_links_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_vehicle_maintenance_links: {
        Row: {
          created_at: string
          document_id: string
          maintenance_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          maintenance_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          maintenance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_vehicle_maintenance_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_vehicle_maintenance_links_maintenance_id_fkey"
            columns: ["maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenances"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          storage_path: string | null
          type: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          date_emission?: string | null
          date_expiration?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["entity_kind"] | null
          id?: string
          nom: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          storage_path?: string | null
          type?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          date_emission?: string | null
          date_expiration?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["entity_kind"] | null
          id?: string
          nom?: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          storage_path?: string | null
          type?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      driver_motorcycle_assignments: {
        Row: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          motorcycle_id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          end_date?: string | null
          id?: string
          motorcycle_id: string
          notes?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          end_date?: string | null
          id?: string
          motorcycle_id?: string
          notes?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_motorcycle_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_motorcycle_assignments_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_vehicle_assignments: {
        Row: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          end_date?: string | null
          id?: string
          notes?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_vehicle_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_vehicle_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          categorie_permis: string | null
          created_at: string
          date_expiration_permis: string | null
          employee_id: string | null
          id: string
          notes: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          numero_permis: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          updated_at: string
        }
        Insert: {
          categorie_permis?: string | null
          created_at?: string
          date_expiration_permis?: string | null
          employee_id?: string | null
          id?: string
          notes?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          numero_permis?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          updated_at?: string
        }
        Update: {
          categorie_permis?: string | null
          created_at?: string
          date_expiration_permis?: string | null
          employee_id?: string | null
          id?: string
          notes?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          numero_permis?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string
          date_embauche: string | null
          date_naissance: string | null
          email: string | null
          id: string
          matricule: string | null
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          poste: string | null
          prenom: string | null
          salaire_base: number | null
          statut: Database["public"]["Enums"]["statut_general"]
          telephone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          date_embauche?: string | null
          date_naissance?: string | null
          email?: string | null
          id?: string
          matricule?: string | null
          nom: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          poste?: string | null
          prenom?: string | null
          salaire_base?: number | null
          statut?: Database["public"]["Enums"]["statut_general"]
          telephone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          date_embauche?: string | null
          date_naissance?: string | null
          email?: string | null
          id?: string
          matricule?: string | null
          nom?: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          poste?: string | null
          prenom?: string | null
          salaire_base?: number | null
          statut?: Database["public"]["Enums"]["statut_general"]
          telephone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          categorie: string
          created_at: string
          date: string
          description: string | null
          farm_id: string
          fournisseur: string | null
          id: string
          montant: number
          updated_at: string
        }
        Insert: {
          categorie: string
          created_at?: string
          date: string
          description?: string | null
          farm_id: string
          fournisseur?: string | null
          id?: string
          montant?: number
          updated_at?: string
        }
        Update: {
          categorie?: string
          created_at?: string
          date?: string
          description?: string | null
          farm_id?: string
          fournisseur?: string | null
          id?: string
          montant?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      farms: {
        Row: {
          code: string | null
          created_at: string
          date_debut_contrat: string | null
          date_fin_contrat: string | null
          departement: string | null
          description: string | null
          id: string
          latitude: number | null
          localisation: string | null
          longitude: number | null
          nature: string | null
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          prix_kg: number | null
          proprietaire: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          superficie: number | null
          superficie_ha: number | null
          telephone: string | null
          type_culture: string | null
          updated_at: string
          village: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          date_debut_contrat?: string | null
          date_fin_contrat?: string | null
          departement?: string | null
          description?: string | null
          id?: string
          latitude?: number | null
          localisation?: string | null
          longitude?: number | null
          nature?: string | null
          nom: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          prix_kg?: number | null
          proprietaire?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          superficie?: number | null
          superficie_ha?: number | null
          telephone?: string | null
          type_culture?: string | null
          updated_at?: string
          village?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          date_debut_contrat?: string | null
          date_fin_contrat?: string | null
          departement?: string | null
          description?: string | null
          id?: string
          latitude?: number | null
          localisation?: string | null
          longitude?: number | null
          nature?: string | null
          nom?: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          prix_kg?: number | null
          proprietaire?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          superficie?: number | null
          superficie_ha?: number | null
          telephone?: string | null
          type_culture?: string | null
          updated_at?: string
          village?: string | null
        }
        Relationships: []
      }
      finance_expense_links: {
        Row: {
          created_at: string
          expense_id: string
          migration_run_id: string
          operation_id: string
        }
        Insert: {
          created_at?: string
          expense_id: string
          migration_run_id: string
          operation_id: string
        }
        Update: {
          created_at?: string
          expense_id?: string
          migration_run_id?: string
          operation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_expense_links_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_expense_links_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_expense_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_harvest_links: {
        Row: {
          created_at: string
          harvest_id: string
          operation_id: string
        }
        Insert: {
          created_at?: string
          harvest_id: string
          operation_id: string
        }
        Update: {
          created_at?: string
          harvest_id?: string
          operation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_harvest_links_harvest_id_fkey"
            columns: ["harvest_id"]
            isOneToOne: true
            referencedRelation: "harvests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_harvest_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_legacy_migration_config: {
        Row: {
          configured_at: string | null
          configured_by: string | null
          default_wallet_id: string | null
          singleton: boolean
          updated_at: string
        }
        Insert: {
          configured_at?: string | null
          configured_by?: string | null
          default_wallet_id?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          configured_at?: string | null
          configured_by?: string | null
          default_wallet_id?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_legacy_migration_config_default_wallet_id_fkey"
            columns: ["default_wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "finance_legacy_migration_config_default_wallet_id_fkey"
            columns: ["default_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_legacy_migration_issues: {
        Row: {
          created_at: string
          details: Json
          id: string
          issue_code: string
          legacy_id: string
          migration_run_id: string
          source_table: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          issue_code: string
          legacy_id: string
          migration_run_id: string
          source_table: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          issue_code?: string
          legacy_id?: string
          migration_run_id?: string
          source_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_legacy_migration_issues_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_legacy_snapshot_expenses: {
        Row: {
          legacy_id: string
          migration_run_id: string
          row_data: Json
        }
        Insert: {
          legacy_id: string
          migration_run_id: string
          row_data: Json
        }
        Update: {
          legacy_id?: string
          migration_run_id?: string
          row_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "finance_legacy_snapshot_expenses_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_legacy_snapshot_links: {
        Row: {
          link_id: string
          migration_run_id: string
          row_data: Json
        }
        Insert: {
          link_id: string
          migration_run_id: string
          row_data: Json
        }
        Update: {
          link_id?: string
          migration_run_id?: string
          row_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "finance_legacy_snapshot_links_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_legacy_snapshot_operations: {
        Row: {
          migration_run_id: string
          operation_id: string
          row_data: Json
        }
        Insert: {
          migration_run_id: string
          operation_id: string
          row_data: Json
        }
        Update: {
          migration_run_id?: string
          operation_id?: string
          row_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "finance_legacy_snapshot_operations_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_legacy_snapshot_payments: {
        Row: {
          legacy_id: string
          migration_run_id: string
          row_data: Json
        }
        Insert: {
          legacy_id: string
          migration_run_id: string
          row_data: Json
        }
        Update: {
          legacy_id?: string
          migration_run_id?: string
          row_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "finance_legacy_snapshot_payments_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_legacy_snapshot_revenues: {
        Row: {
          legacy_id: string
          migration_run_id: string
          row_data: Json
        }
        Insert: {
          legacy_id: string
          migration_run_id: string
          row_data: Json
        }
        Update: {
          legacy_id?: string
          migration_run_id?: string
          row_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "finance_legacy_snapshot_revenues_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_legacy_snapshot_wallets: {
        Row: {
          migration_run_id: string
          row_data: Json
          wallet_id: string
        }
        Insert: {
          migration_run_id: string
          row_data: Json
          wallet_id: string
        }
        Update: {
          migration_run_id?: string
          row_data?: Json
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_legacy_snapshot_wallets_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_links: {
        Row: {
          created_at: string | null
          finance_operation_id: string
          id: string
          module: string
          module_record_id: string
        }
        Insert: {
          created_at?: string | null
          finance_operation_id: string
          id?: string
          module: string
          module_record_id: string
        }
        Update: {
          created_at?: string | null
          finance_operation_id?: string
          id?: string
          module?: string
          module_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_links_finance_operation_id_fkey"
            columns: ["finance_operation_id"]
            isOneToOne: false
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_migration_runs: {
        Row: {
          backfilled_at: string | null
          created_at: string
          id: string
          metadata: Json
          migration_key: string
          snapshot_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          backfilled_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          migration_key: string
          snapshot_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          backfilled_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          migration_key?: string
          snapshot_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_motorcycle_maintenance_links: {
        Row: {
          created_at: string
          motorcycle_maintenance_id: string
          operation_id: string
        }
        Insert: {
          created_at?: string
          motorcycle_maintenance_id: string
          operation_id: string
        }
        Update: {
          created_at?: string
          motorcycle_maintenance_id?: string
          operation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_motorcycle_maintenance_l_motorcycle_maintenance_id_fkey"
            columns: ["motorcycle_maintenance_id"]
            isOneToOne: true
            referencedRelation: "motorcycle_maintenances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_motorcycle_maintenance_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_motorcycle_purchase_links: {
        Row: {
          created_at: string
          motorcycle_id: string
          operation_id: string
        }
        Insert: {
          created_at?: string
          motorcycle_id: string
          operation_id: string
        }
        Update: {
          created_at?: string
          motorcycle_id?: string
          operation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_motorcycle_purchase_links_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: true
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_motorcycle_purchase_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_operations: {
        Row: {
          amount: number
          attachment_url: string | null
          category: string | null
          client: string | null
          contract_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          destination_wallet_id: string | null
          driver_id: string | null
          employee: string | null
          employee_id: string | null
          farm_id: string | null
          harvest_id: string | null
          id: string
          inventory_item_id: string | null
          maintenance_id: string | null
          module: string | null
          module_id: string | null
          motorcycle_id: string | null
          motorcycle_maintenance_id: string | null
          notes: string | null
          operation_date: string
          origin: string | null
          payment_method: string | null
          payment_reference: string | null
          project: string | null
          reference: string | null
          status: string | null
          supplier: string | null
          type: string
          updated_at: string | null
          vehicle_id: string | null
          wallet_id: string
        }
        Insert: {
          amount: number
          attachment_url?: string | null
          category?: string | null
          client?: string | null
          contract_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          destination_wallet_id?: string | null
          driver_id?: string | null
          employee?: string | null
          employee_id?: string | null
          farm_id?: string | null
          harvest_id?: string | null
          id?: string
          inventory_item_id?: string | null
          maintenance_id?: string | null
          module?: string | null
          module_id?: string | null
          motorcycle_id?: string | null
          motorcycle_maintenance_id?: string | null
          notes?: string | null
          operation_date: string
          origin?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          project?: string | null
          reference?: string | null
          status?: string | null
          supplier?: string | null
          type: string
          updated_at?: string | null
          vehicle_id?: string | null
          wallet_id: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          category?: string | null
          client?: string | null
          contract_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          destination_wallet_id?: string | null
          driver_id?: string | null
          employee?: string | null
          employee_id?: string | null
          farm_id?: string | null
          harvest_id?: string | null
          id?: string
          inventory_item_id?: string | null
          maintenance_id?: string | null
          module?: string | null
          module_id?: string | null
          motorcycle_id?: string | null
          motorcycle_maintenance_id?: string | null
          notes?: string | null
          operation_date?: string
          origin?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          project?: string | null
          reference?: string | null
          status?: string | null
          supplier?: string | null
          type?: string
          updated_at?: string | null
          vehicle_id?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_operations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_destination_wallet_id_fkey"
            columns: ["destination_wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "finance_operations_destination_wallet_id_fkey"
            columns: ["destination_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_harvest_id_fkey"
            columns: ["harvest_id"]
            isOneToOne: false
            referencedRelation: "harvests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_maintenance_id_fkey"
            columns: ["maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_motorcycle_maintenance_id_fkey"
            columns: ["motorcycle_maintenance_id"]
            isOneToOne: false
            referencedRelation: "motorcycle_maintenances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_operations_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "finance_operations_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      field_wallet_assignments: {
        Row: FieldWalletAssignmentRow
        Insert: { id?: string; user_id: string; wallet_id: string; assignment_type?: string; label?: string | null; is_active?: boolean; assigned_by?: string | null; assigned_at?: string; revoked_at?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; user_id?: string; wallet_id?: string; assignment_type?: string; label?: string | null; is_active?: boolean; assigned_by?: string | null; assigned_at?: string; revoked_at?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      field_reports: {
        Row: FieldReportRow
        Insert: { id?: string; report_number: string; report_type: string; period_start: string; period_end: string; status?: string; notes?: string | null; created_by: string; submitted_at?: string | null; reviewed_at?: string | null; reviewed_by?: string | null; review_note?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; report_number?: string; report_type?: string; period_start?: string; period_end?: string; status?: string; notes?: string | null; created_by?: string; submitted_at?: string | null; reviewed_at?: string | null; reviewed_by?: string | null; review_note?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      field_declarations: {
        Row: FieldDeclarationRow
        Insert: { id?: string; report_id: string; declaration_type: string; status?: string; amount: number; occurred_at?: string; field_wallet_id: string; destination_wallet_id?: string | null; category: string; description?: string | null; reference?: string | null; client_id?: string | null; farm_id?: string | null; inventory_item_id?: string | null; document_id?: string | null; client_submission_id?: string | null; created_by: string; submitted_at?: string | null; confirmed_at?: string | null; confirmed_by?: string | null; rejected_at?: string | null; rejected_by?: string | null; rejection_reason?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; report_id?: string; declaration_type?: string; status?: string; amount?: number; occurred_at?: string; field_wallet_id?: string; destination_wallet_id?: string | null; category?: string; description?: string | null; reference?: string | null; client_id?: string | null; farm_id?: string | null; inventory_item_id?: string | null; document_id?: string | null; client_submission_id?: string | null; created_by?: string; submitted_at?: string | null; confirmed_at?: string | null; confirmed_by?: string | null; rejected_at?: string | null; rejected_by?: string | null; rejection_reason?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      finance_field_declaration_links: {
        Row: { operation_id: string; declaration_id: string; created_at: string }
        Insert: { operation_id: string; declaration_id: string; created_at?: string }
        Update: { operation_id?: string; declaration_id?: string; created_at?: string }
        Relationships: []
      }
      finance_payment_links: {
        Row: {
          created_at: string
          legacy_payment_type: string
          migration_run_id: string
          operation_id: string
          payment_id: string
        }
        Insert: {
          created_at?: string
          legacy_payment_type: string
          migration_run_id: string
          operation_id: string
          payment_id: string
        }
        Update: {
          created_at?: string
          legacy_payment_type?: string
          migration_run_id?: string
          operation_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_payment_links_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_links_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_revenue_links: {
        Row: {
          created_at: string
          legacy_entity_id: string | null
          legacy_entity_type: string | null
          migration_run_id: string
          operation_id: string
          revenue_id: string
        }
        Insert: {
          created_at?: string
          legacy_entity_id?: string | null
          legacy_entity_type?: string | null
          migration_run_id: string
          operation_id: string
          revenue_id: string
        }
        Update: {
          created_at?: string
          legacy_entity_id?: string | null
          legacy_entity_type?: string | null
          migration_run_id?: string
          operation_id?: string
          revenue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_revenue_links_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "finance_migration_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_revenue_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_revenue_links_revenue_id_fkey"
            columns: ["revenue_id"]
            isOneToOne: true
            referencedRelation: "revenues"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_salary_links: {
        Row: {
          created_at: string
          operation_id: string
          salary_payment_id: string
        }
        Insert: {
          created_at?: string
          operation_id: string
          salary_payment_id: string
        }
        Update: {
          created_at?: string
          operation_id?: string
          salary_payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_salary_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_salary_links_salary_payment_id_fkey"
            columns: ["salary_payment_id"]
            isOneToOne: true
            referencedRelation: "salary_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_stock_movement_links: {
        Row: {
          created_at: string
          operation_id: string
          stock_movement_id: string
        }
        Insert: {
          created_at?: string
          operation_id: string
          stock_movement_id: string
        }
        Update: {
          created_at?: string
          operation_id?: string
          stock_movement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_stock_movement_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_stock_movement_links_stock_movement_id_fkey"
            columns: ["stock_movement_id"]
            isOneToOne: true
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_vehicle_maintenance_links: {
        Row: {
          created_at: string
          maintenance_id: string
          operation_id: string
        }
        Insert: {
          created_at?: string
          maintenance_id: string
          operation_id: string
        }
        Update: {
          created_at?: string
          maintenance_id?: string
          operation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_vehicle_maintenance_links_maintenance_id_fkey"
            columns: ["maintenance_id"]
            isOneToOne: true
            referencedRelation: "maintenances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_vehicle_maintenance_links_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "finance_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      harvests: {
        Row: {
          acheteur: string | null
          created_at: string
          date_recolte: string
          farm_id: string
          id: string
          montant_total: number | null
          observations: string | null
          prix_kg: number
          produit: string
          quantite_kg: number
          sale_wallet_id: string | null
          updated_at: string
        }
        Insert: {
          acheteur?: string | null
          created_at?: string
          date_recolte: string
          farm_id: string
          id?: string
          montant_total?: number | null
          observations?: string | null
          prix_kg?: number
          produit: string
          quantite_kg?: number
          sale_wallet_id?: string | null
          updated_at?: string
        }
        Update: {
          acheteur?: string | null
          created_at?: string
          date_recolte?: string
          farm_id?: string
          id?: string
          montant_total?: number | null
          observations?: string | null
          prix_kg?: number
          produit?: string
          quantite_kg?: number
          sale_wallet_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "harvests_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harvests_sale_wallet_id_fkey"
            columns: ["sale_wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "harvests_sale_wallet_id_fkey"
            columns: ["sale_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          categorie: string | null
          created_at: string
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          seuil_alerte: number | null
          sku: string | null
          stock_actuel: number
          unite: string | null
          updated_at: string
        }
        Insert: {
          categorie?: string | null
          created_at?: string
          id?: string
          nom: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          seuil_alerte?: number | null
          sku?: string | null
          stock_actuel?: number
          unite?: string | null
          updated_at?: string
        }
        Update: {
          categorie?: string | null
          created_at?: string
          id?: string
          nom?: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          seuil_alerte?: number | null
          sku?: string | null
          stock_actuel?: number
          unite?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          item_id: string
          motif: string | null
          quantite: number
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          item_id: string
          motif?: string | null
          quantite: number
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          item_id?: string
          motif?: string | null
          quantite?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenances: {
        Row: {
          cout: number | null
          created_at: string
          date: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["entity_kind"]
          id: string
          kilometrage: number | null
          notes: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          prestataire: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          cout?: number | null
          created_at?: string
          date?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["entity_kind"]
          id?: string
          kilometrage?: number | null
          notes?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          prestataire?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          cout?: number | null
          created_at?: string
          date?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["entity_kind"]
          id?: string
          kilometrage?: number | null
          notes?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          prestataire?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      motorcycle_maintenances: {
        Row: {
          cost: number | null
          created_at: string | null
          description: string | null
          garage: string | null
          id: string
          kilometrage: number | null
          maintenance_date: string
          motorcycle_id: string
          next_date: string | null
          next_kilometrage: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          cost?: number | null
          created_at?: string | null
          description?: string | null
          garage?: string | null
          id?: string
          kilometrage?: number | null
          maintenance_date: string
          motorcycle_id: string
          next_date?: string | null
          next_kilometrage?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          cost?: number | null
          created_at?: string | null
          description?: string | null
          garage?: string | null
          id?: string
          kilometrage?: number | null
          maintenance_date?: string
          motorcycle_id?: string
          next_date?: string | null
          next_kilometrage?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motorcycle_maintenances_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
        ]
      }
      motorcycles: {
        Row: {
          annee: number | null
          assurance_expiration: string | null
          couleur: string | null
          created_at: string
          date_achat: string | null
          derniere_revision: string | null
          driver_id: string | null
          id: string
          immatriculation: string
          kilometrage: number | null
          marque: string | null
          modele: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          observations: string | null
          prix_achat: number | null
          prochaine_revision: string | null
          purchase_wallet_id: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          updated_at: string
          visite_expiration: string | null
        }
        Insert: {
          annee?: number | null
          assurance_expiration?: string | null
          couleur?: string | null
          created_at?: string
          date_achat?: string | null
          derniere_revision?: string | null
          driver_id?: string | null
          id?: string
          immatriculation: string
          kilometrage?: number | null
          marque?: string | null
          modele?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          observations?: string | null
          prix_achat?: number | null
          prochaine_revision?: string | null
          purchase_wallet_id?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          updated_at?: string
          visite_expiration?: string | null
        }
        Update: {
          annee?: number | null
          assurance_expiration?: string | null
          couleur?: string | null
          created_at?: string
          date_achat?: string | null
          derniere_revision?: string | null
          driver_id?: string | null
          id?: string
          immatriculation?: string
          kilometrage?: number | null
          marque?: string | null
          modele?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          observations?: string | null
          prix_achat?: number | null
          prochaine_revision?: string | null
          purchase_wallet_id?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          updated_at?: string
          visite_expiration?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motorcycles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motorcycles_purchase_wallet_id_fkey"
            columns: ["purchase_wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "motorcycles_purchase_wallet_id_fkey"
            columns: ["purchase_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_alert_rules: {
        Row: {
          alert_type: string
          created_at: string
          default_severity: string
          description: string | null
          due_days: number[]
          enabled: boolean
          id: string
          recipient_roles: Database["public"]["Enums"]["app_role"][]
          severity_schedule: Json
          threshold: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alert_type: string
          created_at?: string
          default_severity?: string
          description?: string | null
          due_days?: number[]
          enabled?: boolean
          id?: string
          recipient_roles?: Database["public"]["Enums"]["app_role"][]
          severity_schedule?: Json
          threshold?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alert_type?: string
          created_at?: string
          default_severity?: string
          description?: string | null
          due_days?: number[]
          enabled?: boolean
          id?: string
          recipient_roles?: Database["public"]["Enums"]["app_role"][]
          severity_schedule?: Json
          threshold?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      notification_contract_links: {
        Row: {
          contract_id: string
          created_at: string
          notification_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          notification_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_contract_links_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_contract_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_document_links: {
        Row: {
          created_at: string
          document_id: string
          notification_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          notification_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_document_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_driver_links: {
        Row: {
          created_at: string
          driver_id: string
          notification_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          notification_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_driver_links_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_driver_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_employee_links: {
        Row: {
          created_at: string
          employee_id: string
          notification_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          notification_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_employee_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_employee_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_generation_runs: {
        Row: {
          completed_at: string | null
          created_count: number
          error_count: number
          error_message: string | null
          id: string
          resolved_count: number
          started_at: string
          status: string
          trigger_type: string
          triggered_by: string | null
          updated_count: number
        }
        Insert: {
          completed_at?: string | null
          created_count?: number
          error_count?: number
          error_message?: string | null
          id?: string
          resolved_count?: number
          started_at?: string
          status?: string
          trigger_type: string
          triggered_by?: string | null
          updated_count?: number
        }
        Update: {
          completed_at?: string | null
          created_count?: number
          error_count?: number
          error_message?: string | null
          id?: string
          resolved_count?: number
          started_at?: string
          status?: string
          trigger_type?: string
          triggered_by?: string | null
          updated_count?: number
        }
        Relationships: []
      }
      notification_inventory_links: {
        Row: {
          created_at: string
          inventory_item_id: string
          notification_id: string
        }
        Insert: {
          created_at?: string
          inventory_item_id: string
          notification_id: string
        }
        Update: {
          created_at?: string
          inventory_item_id?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_inventory_links_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_inventory_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_motorcycle_links: {
        Row: {
          created_at: string
          motorcycle_id: string
          notification_id: string
        }
        Insert: {
          created_at?: string
          motorcycle_id: string
          notification_id: string
        }
        Update: {
          created_at?: string
          motorcycle_id?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_motorcycle_links_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_motorcycle_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_motorcycle_maintenance_links: {
        Row: {
          created_at: string
          motorcycle_maintenance_id: string
          notification_id: string
        }
        Insert: {
          created_at?: string
          motorcycle_maintenance_id: string
          notification_id: string
        }
        Update: {
          created_at?: string
          motorcycle_maintenance_id?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_motorcycle_maintena_motorcycle_maintenance_id_fkey"
            columns: ["motorcycle_maintenance_id"]
            isOneToOne: false
            referencedRelation: "motorcycle_maintenances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_motorcycle_maintenance_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings_audit: {
        Row: {
          after_value: Json | null
          before_value: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          performed_by: string | null
          setting_key: string
        }
        Insert: {
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          performed_by?: string | null
          setting_key: string
        }
        Update: {
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          performed_by?: string | null
          setting_key?: string
        }
        Relationships: []
      }
      notification_vehicle_links: {
        Row: {
          created_at: string
          notification_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          notification_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          notification_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_vehicle_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_vehicle_links_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_vehicle_maintenance_links: {
        Row: {
          created_at: string
          maintenance_id: string
          notification_id: string
        }
        Insert: {
          created_at?: string
          maintenance_id: string
          notification_id: string
        }
        Update: {
          created_at?: string
          maintenance_id?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_vehicle_maintenance_links_maintenance_id_fkey"
            columns: ["maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_vehicle_maintenance_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_wallet_links: {
        Row: {
          created_at: string
          notification_id: string
          wallet_id: string
        }
        Insert: {
          created_at?: string
          notification_id: string
          wallet_id: string
        }
        Update: {
          created_at?: string
          notification_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_wallet_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_wallet_links_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "notification_wallet_links_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          deduplication_key: string | null
          due_date: string | null
          entity_route: string | null
          id: string
          lu: boolean
          message: string | null
          read_at: string | null
          resolved_at: string | null
          severity: string
          snoozed_until: string | null
          status: string
          titre: string
          type: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deduplication_key?: string | null
          due_date?: string | null
          entity_route?: string | null
          id?: string
          lu?: boolean
          message?: string | null
          read_at?: string | null
          resolved_at?: string | null
          severity?: string
          snoozed_until?: string | null
          status?: string
          titre: string
          type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deduplication_key?: string | null
          due_date?: string | null
          entity_route?: string | null
          id?: string
          lu?: boolean
          message?: string | null
          read_at?: string | null
          resolved_at?: string | null
          severity?: string
          snoozed_until?: string | null
          status?: string
          titre?: string
          type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      notion_database_mappings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          last_synced_at: string | null
          module_key: string
          notion_database_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_synced_at?: string | null
          module_key: string
          notion_database_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_synced_at?: string | null
          module_key?: string
          notion_database_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          contract_id: string | null
          created_at: string
          date: string
          description: string | null
          id: string
          methode: string | null
          montant: number
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          reference: string | null
          type: string
          updated_at: string
        }
        Insert: {
          contract_id?: string | null
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          methode?: string | null
          montant?: number
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          reference?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          contract_id?: string | null
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          methode?: string | null
          montant?: number
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          reference?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          code: string
          created_at: string
          description: string
          module: string
          sensitivity: string
          updated_at: string
        }
        Insert: {
          action: string
          code: string
          created_at?: string
          description: string
          module: string
          sensitivity: string
          updated_at?: string
        }
        Update: {
          action?: string
          code?: string
          created_at?: string
          description?: string
          module?: string
          sensitivity?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          locale: string
          phone: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          phone?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          phone?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      revenues: {
        Row: {
          created_at: string
          date: string
          description: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          montant: number
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date?: string
          description?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["entity_kind"] | null
          id?: string
          montant?: number
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          description?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["entity_kind"] | null
          id?: string
          montant?: number
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          permission_code: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          permission_code: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          permission_code?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_permissions_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      roles: {
        Row: {
          code: Database["public"]["Enums"]["app_role"]
          created_at: string
          description: string
          is_active: boolean
          is_system: boolean
          label: string
          updated_at: string
        }
        Insert: {
          code: Database["public"]["Enums"]["app_role"]
          created_at?: string
          description: string
          is_active?: boolean
          is_system?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          code?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          description?: string
          is_active?: boolean
          is_system?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      salary_payments: {
        Row: {
          amount: number
          contract_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          driver_id: string | null
          employee_id: string
          id: string
          is_partial: boolean
          paid_at: string
          period_start: string
          reference: string | null
          status: string
          updated_at: string
          wallet_id: string
        }
        Insert: {
          amount: number
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          driver_id?: string | null
          employee_id: string
          id?: string
          is_partial?: boolean
          paid_at?: string
          period_start: string
          reference?: string | null
          status?: string
          updated_at?: string
          wallet_id: string
        }
        Update: {
          amount?: number
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          driver_id?: string | null
          employee_id?: string
          id?: string
          is_partial?: boolean
          paid_at?: string
          period_start?: string
          reference?: string | null
          status?: string
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_payments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_payments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_payments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_payments_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "salary_payments_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_reports: {
        Row: {
          created_at: string
          filters: Json
          id: string
          is_admin_template: boolean
          is_shared: boolean
          name: string
          owner_user_id: string
          period_key: string | null
          report_type: string
          sort: Json
          updated_at: string
          visible_columns: Json
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          is_admin_template?: boolean
          is_shared?: boolean
          name: string
          owner_user_id?: string
          period_key?: string | null
          report_type: string
          sort?: Json
          updated_at?: string
          visible_columns?: Json
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          is_admin_template?: boolean
          is_shared?: boolean
          name?: string
          owner_user_id?: string
          period_key?: string | null
          report_type?: string
          sort?: Json
          updated_at?: string
          visible_columns?: Json
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          client: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          inventory_item_id: string
          movement_date: string
          movement_type: string
          quantity: number
          reference: string | null
          status: string
          supplier: string | null
          unit_price: number | null
          updated_at: string
          wallet_id: string | null
        }
        Insert: {
          client?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          inventory_item_id: string
          movement_date?: string
          movement_type: string
          quantity: number
          reference?: string | null
          status?: string
          supplier?: string | null
          unit_price?: number | null
          updated_at?: string
          wallet_id?: string | null
        }
        Update: {
          client?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          inventory_item_id?: string
          movement_date?: string
          movement_type?: string
          quantity?: number
          reference?: string | null
          status?: string
          supplier?: string | null
          unit_price?: number | null
          updated_at?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "stock_movements_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      stocks: {
        Row: {
          categorie: string | null
          created_at: string | null
          date_entree: string | null
          date_expiration: string | null
          description: string | null
          emplacement: string | null
          fournisseur: string | null
          id: string
          nom: string
          prix_achat: number | null
          prix_vente: number | null
          quantite: number
          reference: string | null
          stock_minimum: number | null
          unite: string
          updated_at: string | null
        }
        Insert: {
          categorie?: string | null
          created_at?: string | null
          date_entree?: string | null
          date_expiration?: string | null
          description?: string | null
          emplacement?: string | null
          fournisseur?: string | null
          id?: string
          nom: string
          prix_achat?: number | null
          prix_vente?: number | null
          quantite?: number
          reference?: string | null
          stock_minimum?: number | null
          unite?: string
          updated_at?: string | null
        }
        Update: {
          categorie?: string | null
          created_at?: string | null
          date_entree?: string | null
          date_expiration?: string | null
          description?: string | null
          emplacement?: string | null
          fournisseur?: string | null
          id?: string
          nom?: string
          prix_achat?: number | null
          prix_vente?: number | null
          quantite?: number
          reference?: string | null
          stock_minimum?: number | null
          unite?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          brand: string | null
          chassis_number: string | null
          color: string | null
          created_at: string
          description: string | null
          driver_id: string | null
          engine_number: string | null
          id: string
          kilometrage: number | null
          model: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          photo_url: string | null
          purchase_date: string | null
          purchase_price: number | null
          purchase_wallet_id: string | null
          registration: string
          status: string | null
          supplier: string | null
          type: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          brand?: string | null
          chassis_number?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          driver_id?: string | null
          engine_number?: string | null
          id?: string
          kilometrage?: number | null
          model?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          photo_url?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          purchase_wallet_id?: string | null
          registration: string
          status?: string | null
          supplier?: string | null
          type?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          brand?: string | null
          chassis_number?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          driver_id?: string | null
          engine_number?: string | null
          id?: string
          kilometrage?: number | null
          model?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          photo_url?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          purchase_wallet_id?: string | null
          registration?: string
          status?: string | null
          supplier?: string | null
          type?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_purchase_wallet_id_fkey"
            columns: ["purchase_wallet_id"]
            isOneToOne: false
            referencedRelation: "finance_wallet_reconciliation"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "vehicles_purchase_wallet_id_fkey"
            columns: ["purchase_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_missions: {
        Row: TransportMissionRow
        Insert: Partial<TransportMissionRow> & { mission_number: string; client_id: string }
        Update: Partial<TransportMissionRow>
        Relationships: []
      }
      transport_mission_budget_lines: {
        Row: TransportBudgetLineRow
        Insert: Partial<TransportBudgetLineRow> & { mission_id: string; category: string; planned_amount: number }
        Update: Partial<TransportBudgetLineRow>
        Relationships: []
      }
      transport_mission_expenses: {
        Row: TransportExpenseRow
        Insert: Partial<TransportExpenseRow> & { mission_id: string; wallet_id: string; category: string; amount: number }
        Update: Partial<TransportExpenseRow>
        Relationships: []
      }
      transport_invoices: {
        Row: TransportInvoiceRow
        Insert: Partial<TransportInvoiceRow> & { invoice_number: string; mission_id: string; client_id: string; subtotal_amount: number; total_amount: number }
        Update: Partial<TransportInvoiceRow>
        Relationships: []
      }
      transport_invoice_payments: {
        Row: TransportPaymentRow
        Insert: Partial<TransportPaymentRow> & { invoice_id: string; mission_id: string; wallet_id: string; amount: number }
        Update: Partial<TransportPaymentRow>
        Relationships: []
      }
      finance_transport_mission_expense_links: {
        Row: { expense_id: string; operation_id: string; link_type: string; created_at: string }
        Insert: { expense_id: string; operation_id: string; link_type?: string; created_at?: string }
        Update: { expense_id?: string; operation_id?: string; link_type?: string; created_at?: string }
        Relationships: []
      }
      finance_transport_payment_links: {
        Row: { payment_id: string; operation_id: string; link_type: string; created_at: string }
        Insert: { payment_id: string; operation_id: string; link_type?: string; created_at?: string }
        Update: { payment_id?: string; operation_id?: string; link_type?: string; created_at?: string }
        Relationships: []
      }
      document_transport_mission_links: {
        Row: { document_id: string; mission_id: string; created_at: string; created_by: string | null }
        Insert: { document_id: string; mission_id: string; created_at?: string; created_by?: string | null }
        Update: { document_id?: string; mission_id?: string; created_at?: string; created_by?: string | null }
        Relationships: []
      }
      wallets: {
        Row: {
          alert_threshold: number | null
          balance: number | null
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          initial_balance: number
          is_default: boolean | null
          name: string
          type: string
          updated_at: string | null
        }
        Insert: {
          alert_threshold?: number | null
          balance?: number | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          initial_balance?: number
          is_default?: boolean | null
          name: string
          type: string
          updated_at?: string | null
        }
        Update: {
          alert_threshold?: number | null
          balance?: number | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          initial_balance?: number
          is_default?: boolean | null
          name?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      finance_legacy_migration_reconciliation: {
        Row: {
          migrated_amount: number | null
          migrated_rows: number | null
          migration_key: string | null
          migration_run_id: string | null
          source_amount: number | null
          source_rows: number | null
          source_table: string | null
        }
        Relationships: []
      }
      finance_wallet_reconciliation: {
        Row: {
          calculated_balance: number | null
          expense_total: number | null
          incoming_total: number | null
          stored_balance: number | null
          transfers_in_total: number | null
          transfers_out_total: number | null
          wallet_id: string | null
          wallet_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _internal_archive_document: {
        Args: { p_document_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          storage_path: string | null
          type: string | null
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_assign_driver_to_motorcycle: {
        Args: {
          p_driver_id: string
          p_motorcycle_id: string
          p_notes?: string
          p_start_date?: string
        }
        Returns: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          motorcycle_id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_motorcycle_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_assign_driver_to_vehicle: {
        Args: {
          p_driver_id: string
          p_notes?: string
          p_start_date?: string
          p_vehicle_id: string
        }
        Returns: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_vehicle_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_cancel_salary_payment_with_finance: {
        Args: { p_payment_id: string }
        Returns: boolean
      }
      _internal_cancel_stock_movement_with_finance: {
        Args: { p_movement_id: string }
        Returns: boolean
      }
      _internal_close_driver_motorcycle_assignment: {
        Args: { p_assignment_id: string; p_end_date?: string; p_notes?: string }
        Returns: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          motorcycle_id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_motorcycle_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_close_driver_vehicle_assignment: {
        Args: { p_assignment_id: string; p_end_date?: string; p_notes?: string }
        Returns: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_vehicle_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_contract_with_relations: {
        Args: { p_contract: Json; p_relations?: Json }
        Returns: {
          created_at: string
          date_debut: string | null
          date_fin: string | null
          description: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          montant: number | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          partie: string | null
          reference: string | null
          statut: string | null
          type: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_document_with_relation: {
        Args: { p_document: Json; p_entity_id: string; p_relation: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          storage_path: string | null
          type: string | null
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_harvest_with_finance: {
        Args: { p_harvest: Json }
        Returns: {
          acheteur: string | null
          created_at: string
          date_recolte: string
          farm_id: string
          id: string
          montant_total: number | null
          observations: string | null
          prix_kg: number
          produit: string
          quantite_kg: number
          sale_wallet_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "harvests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_motorcycle_maintenance_with_finance: {
        Args: { p_maintenance: Json }
        Returns: {
          cost: number | null
          created_at: string | null
          description: string | null
          garage: string | null
          id: string
          kilometrage: number | null
          maintenance_date: string
          motorcycle_id: string
          next_date: string | null
          next_kilometrage: number | null
          type: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "motorcycle_maintenances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_motorcycle_with_purchase: {
        Args: { p_motorcycle: Json }
        Returns: {
          annee: number | null
          assurance_expiration: string | null
          couleur: string | null
          created_at: string
          date_achat: string | null
          derniere_revision: string | null
          driver_id: string | null
          id: string
          immatriculation: string
          kilometrage: number | null
          marque: string | null
          modele: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          observations: string | null
          prix_achat: number | null
          prochaine_revision: string | null
          purchase_wallet_id: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          updated_at: string
          visite_expiration: string | null
        }
        SetofOptions: {
          from: "*"
          to: "motorcycles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_salary_payment_with_finance: {
        Args: { p_payment: Json }
        Returns: {
          amount: number
          contract_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          driver_id: string | null
          employee_id: string
          id: string
          is_partial: boolean
          paid_at: string
          period_start: string
          reference: string | null
          status: string
          updated_at: string
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "salary_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_stock_movement_with_finance: {
        Args: { p_movement: Json }
        Returns: {
          client: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          inventory_item_id: string
          movement_date: string
          movement_type: string
          quantity: number
          reference: string | null
          status: string
          supplier: string | null
          unit_price: number | null
          updated_at: string
          wallet_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_vehicle_maintenance_with_finance: {
        Args: { p_maintenance: Json }
        Returns: {
          cout: number | null
          created_at: string
          date: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["entity_kind"]
          id: string
          kilometrage: number | null
          notes: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          prestataire: string | null
          type: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "maintenances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_create_vehicle_with_purchase: {
        Args: { p_vehicle: Json }
        Returns: {
          brand: string | null
          chassis_number: string | null
          color: string | null
          created_at: string
          description: string | null
          driver_id: string | null
          engine_number: string | null
          id: string
          kilometrage: number | null
          model: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          photo_url: string | null
          purchase_date: string | null
          purchase_price: number | null
          purchase_wallet_id: string | null
          registration: string
          status: string | null
          supplier: string | null
          type: string | null
          updated_at: string
          year: number | null
        }
        SetofOptions: {
          from: "*"
          to: "vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_delete_harvest_with_finance: {
        Args: { p_harvest_id: string }
        Returns: boolean
      }
      _internal_delete_motorcycle_maintenance_with_finance: {
        Args: { p_maintenance_id: string }
        Returns: boolean
      }
      _internal_delete_motorcycle_with_purchase: {
        Args: { p_motorcycle_id: string }
        Returns: boolean
      }
      _internal_delete_vehicle_maintenance_with_finance: {
        Args: { p_maintenance_id: string }
        Returns: boolean
      }
      _internal_delete_vehicle_with_purchase: {
        Args: { p_vehicle_id: string }
        Returns: boolean
      }
      _internal_update_harvest_with_finance: {
        Args: { p_harvest: Json }
        Returns: {
          acheteur: string | null
          created_at: string
          date_recolte: string
          farm_id: string
          id: string
          montant_total: number | null
          observations: string | null
          prix_kg: number
          produit: string
          quantite_kg: number
          sale_wallet_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "harvests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_update_motorcycle_maintenance_with_finance: {
        Args: { p_maintenance: Json }
        Returns: {
          cost: number | null
          created_at: string | null
          description: string | null
          garage: string | null
          id: string
          kilometrage: number | null
          maintenance_date: string
          motorcycle_id: string
          next_date: string | null
          next_kilometrage: number | null
          type: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "motorcycle_maintenances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_update_motorcycle_with_purchase: {
        Args: { p_motorcycle: Json }
        Returns: {
          annee: number | null
          assurance_expiration: string | null
          couleur: string | null
          created_at: string
          date_achat: string | null
          derniere_revision: string | null
          driver_id: string | null
          id: string
          immatriculation: string
          kilometrage: number | null
          marque: string | null
          modele: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          observations: string | null
          prix_achat: number | null
          prochaine_revision: string | null
          purchase_wallet_id: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          updated_at: string
          visite_expiration: string | null
        }
        SetofOptions: {
          from: "*"
          to: "motorcycles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_update_salary_payment_with_finance: {
        Args: { p_payment: Json }
        Returns: {
          amount: number
          contract_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          driver_id: string | null
          employee_id: string
          id: string
          is_partial: boolean
          paid_at: string
          period_start: string
          reference: string | null
          status: string
          updated_at: string
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "salary_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_update_stock_movement_with_finance: {
        Args: { p_movement: Json }
        Returns: {
          client: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          inventory_item_id: string
          movement_date: string
          movement_type: string
          quantity: number
          reference: string | null
          status: string
          supplier: string | null
          unit_price: number | null
          updated_at: string
          wallet_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_update_vehicle_maintenance_with_finance: {
        Args: { p_maintenance: Json }
        Returns: {
          cout: number | null
          created_at: string
          date: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["entity_kind"]
          id: string
          kilometrage: number | null
          notes: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          prestataire: string | null
          type: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "maintenances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _internal_update_vehicle_with_purchase: {
        Args: { p_vehicle: Json }
        Returns: {
          brand: string | null
          chassis_number: string | null
          color: string | null
          created_at: string
          description: string | null
          driver_id: string | null
          engine_number: string | null
          id: string
          kilometrage: number | null
          model: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          photo_url: string | null
          purchase_date: string | null
          purchase_price: number | null
          purchase_wallet_id: string | null
          registration: string
          status: string | null
          supplier: string | null
          type: string | null
          updated_at: string
          year: number | null
        }
        SetofOptions: {
          from: "*"
          to: "vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_document: {
        Args: { p_document_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          storage_path: string | null
          type: string | null
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_client: {
        Args: { p_client_id: string }
        Returns: Database["public"]["Tables"]["transport_clients"]["Row"]
        SetofOptions: {
          from: "*"
          to: "transport_clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_driver_to_motorcycle: {
        Args: {
          p_driver_id: string
          p_motorcycle_id: string
          p_notes?: string
          p_start_date?: string
        }
        Returns: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          motorcycle_id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_motorcycle_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_driver_to_vehicle: {
        Args: {
          p_driver_id: string
          p_notes?: string
          p_start_date?: string
          p_vehicle_id: string
        }
        Returns: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_vehicle_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      backfill_legacy_finance_operations: {
        Args: { p_migration_key?: string }
        Returns: Json
      }
      business_cancel_finance_operation: {
        Args: { p_operation_id: string }
        Returns: {
          amount: number
          attachment_url: string | null
          category: string | null
          client: string | null
          contract_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          destination_wallet_id: string | null
          driver_id: string | null
          employee: string | null
          employee_id: string | null
          farm_id: string | null
          harvest_id: string | null
          id: string
          inventory_item_id: string | null
          maintenance_id: string | null
          module: string | null
          module_id: string | null
          motorcycle_id: string | null
          motorcycle_maintenance_id: string | null
          notes: string | null
          operation_date: string
          origin: string | null
          payment_method: string | null
          payment_reference: string | null
          project: string | null
          reference: string | null
          status: string | null
          supplier: string | null
          type: string
          updated_at: string | null
          vehicle_id: string | null
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "finance_operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      business_finance_audit_event: {
        Args: {
          p_action: string
          p_after_value?: Json
          p_before_value?: Json
          p_operation_id: string
          p_source_id: string
          p_source_type: string
        }
        Returns: undefined
      }
      business_finance_require_write_role: { Args: never; Returns: undefined }
      business_upsert_finance_operation:
        | {
            Args: {
              p_amount: number
              p_category: string
              p_client?: string
              p_contract_id?: string
              p_description: string
              p_driver_id?: string
              p_employee_id?: string
              p_farm_id?: string
              p_harvest_id?: string
              p_inventory_item_id?: string
              p_maintenance_id?: string
              p_module: string
              p_module_id: string
              p_motorcycle_id?: string
              p_motorcycle_maintenance_id?: string
              p_operation_date: string
              p_operation_id: string
              p_origin: string
              p_reference?: string
              p_supplier?: string
              p_type: string
              p_vehicle_id?: string
              p_wallet_id: string
            }
            Returns: {
              amount: number
              attachment_url: string | null
              category: string | null
              client: string | null
              contract_id: string | null
              created_at: string | null
              created_by: string | null
              description: string | null
              destination_wallet_id: string | null
              driver_id: string | null
              employee: string | null
              employee_id: string | null
              farm_id: string | null
              harvest_id: string | null
              id: string
              inventory_item_id: string | null
              maintenance_id: string | null
              module: string | null
              module_id: string | null
              motorcycle_id: string | null
              motorcycle_maintenance_id: string | null
              notes: string | null
              operation_date: string
              origin: string | null
              payment_method: string | null
              payment_reference: string | null
              project: string | null
              reference: string | null
              status: string | null
              supplier: string | null
              type: string
              updated_at: string | null
              vehicle_id: string | null
              wallet_id: string
            }
            SetofOptions: {
              from: "*"
              to: "finance_operations"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_amount: number
              p_category: string
              p_client: string
              p_contract_id: string
              p_description: string
              p_driver_id: string
              p_employee_id: string
              p_farm_id: string
              p_harvest_id: string
              p_inventory_item_id: string
              p_legacy_unused_id: string
              p_maintenance_id: string
              p_module: string
              p_module_id: string
              p_motorcycle_id: string
              p_motorcycle_maintenance_id: string
              p_operation_date: string
              p_operation_id: string
              p_origin: string
              p_reference: string
              p_supplier: string
              p_type: string
              p_vehicle_id: string
              p_wallet_id: string
            }
            Returns: {
              amount: number
              attachment_url: string | null
              category: string | null
              client: string | null
              contract_id: string | null
              created_at: string | null
              created_by: string | null
              description: string | null
              destination_wallet_id: string | null
              driver_id: string | null
              employee: string | null
              employee_id: string | null
              farm_id: string | null
              harvest_id: string | null
              id: string
              inventory_item_id: string | null
              maintenance_id: string | null
              module: string | null
              module_id: string | null
              motorcycle_id: string | null
              motorcycle_maintenance_id: string | null
              notes: string | null
              operation_date: string
              origin: string | null
              payment_method: string | null
              payment_reference: string | null
              project: string | null
              reference: string | null
              status: string | null
              supplier: string | null
              type: string
              updated_at: string | null
              vehicle_id: string | null
              wallet_id: string
            }
            SetofOptions: {
              from: "*"
              to: "finance_operations"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      cancel_salary_payment_with_finance: {
        Args: { p_payment_id: string }
        Returns: boolean
      }
      cancel_stock_movement_with_finance: {
        Args: { p_movement_id: string }
        Returns: boolean
      }
      close_driver_motorcycle_assignment: {
        Args: { p_assignment_id: string; p_end_date?: string; p_notes?: string }
        Returns: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          motorcycle_id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_motorcycle_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_driver_vehicle_assignment: {
        Args: { p_assignment_id: string; p_end_date?: string; p_notes?: string }
        Returns: {
          created_at: string
          driver_id: string
          end_date: string | null
          id: string
          notes: string | null
          start_date: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_vehicle_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_contract_with_relations: {
        Args: { p_contract: Json; p_relations?: Json }
        Returns: {
          created_at: string
          date_debut: string | null
          date_fin: string | null
          description: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          montant: number | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          partie: string | null
          reference: string | null
          statut: string | null
          type: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_client: {
        Args: { p_client: Json }
        Returns: Database["public"]["Tables"]["transport_clients"]["Row"]
        SetofOptions: {
          from: "*"
          to: "transport_clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_document_with_relation: {
        Args: { p_document: Json; p_entity_id: string; p_relation: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          storage_path: string | null
          type: string | null
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_harvest_with_finance: {
        Args: { p_harvest: Json }
        Returns: {
          acheteur: string | null
          created_at: string
          date_recolte: string
          farm_id: string
          id: string
          montant_total: number | null
          observations: string | null
          prix_kg: number
          produit: string
          quantite_kg: number
          sale_wallet_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "harvests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_legacy_finance_snapshot: {
        Args: { p_migration_key: string }
        Returns: string
      }
      create_motorcycle_maintenance_with_finance: {
        Args: { p_maintenance: Json }
        Returns: {
          cost: number | null
          created_at: string | null
          description: string | null
          garage: string | null
          id: string
          kilometrage: number | null
          maintenance_date: string
          motorcycle_id: string
          next_date: string | null
          next_kilometrage: number | null
          type: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "motorcycle_maintenances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_motorcycle_with_purchase: {
        Args: { p_motorcycle: Json }
        Returns: {
          annee: number | null
          assurance_expiration: string | null
          couleur: string | null
          created_at: string
          date_achat: string | null
          derniere_revision: string | null
          driver_id: string | null
          id: string
          immatriculation: string
          kilometrage: number | null
          marque: string | null
          modele: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          observations: string | null
          prix_achat: number | null
          prochaine_revision: string | null
          purchase_wallet_id: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          updated_at: string
          visite_expiration: string | null
        }
        SetofOptions: {
          from: "*"
          to: "motorcycles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_or_update_notification_for_roles: {
        Args: {
          p_contract_id?: string
          p_deduplication_base: string
          p_document_id?: string
          p_driver_id?: string
          p_due_date: string
          p_employee_id?: string
          p_entity_route: string
          p_inventory_item_id?: string
          p_message: string
          p_motorcycle_id?: string
          p_motorcycle_maintenance_id?: string
          p_roles: Database["public"]["Enums"]["app_role"][]
          p_severity: string
          p_title: string
          p_type: string
          p_vehicle_id?: string
          p_vehicle_maintenance_id?: string
          p_wallet_id?: string
        }
        Returns: number
      }
      create_salary_payment_with_finance: {
        Args: { p_payment: Json }
        Returns: {
          amount: number
          contract_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          driver_id: string | null
          employee_id: string
          id: string
          is_partial: boolean
          paid_at: string
          period_start: string
          reference: string | null
          status: string
          updated_at: string
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "salary_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_stock_movement_with_finance: {
        Args: { p_movement: Json }
        Returns: {
          client: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          inventory_item_id: string
          movement_date: string
          movement_type: string
          quantity: number
          reference: string | null
          status: string
          supplier: string | null
          unit_price: number | null
          updated_at: string
          wallet_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_vehicle_maintenance_with_finance: {
        Args: { p_maintenance: Json }
        Returns: {
          cout: number | null
          created_at: string
          date: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["entity_kind"]
          id: string
          kilometrage: number | null
          notes: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          prestataire: string | null
          type: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "maintenances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_vehicle_with_purchase: {
        Args: { p_vehicle: Json }
        Returns: {
          brand: string | null
          chassis_number: string | null
          color: string | null
          created_at: string
          description: string | null
          driver_id: string | null
          engine_number: string | null
          id: string
          kilometrage: number | null
          model: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          photo_url: string | null
          purchase_date: string | null
          purchase_price: number | null
          purchase_wallet_id: string | null
          registration: string
          status: string | null
          supplier: string | null
          type: string | null
          updated_at: string
          year: number | null
        }
        SetofOptions: {
          from: "*"
          to: "vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_can_read_document: {
        Args: { p_document_id: string }
        Returns: boolean
      }
      current_user_can_read_document_path: {
        Args: { p_storage_path: string }
        Returns: boolean
      }
      current_user_has_any_role: {
        Args: { p_roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      current_user_permissions: {
        Args: never
        Returns: {
          permission_code: string
        }[]
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      delete_document_metadata: {
        Args: { p_document_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          storage_path: string | null
          type: string | null
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_harvest_with_finance: {
        Args: { p_harvest_id: string }
        Returns: boolean
      }
      delete_motorcycle_maintenance_with_finance: {
        Args: { p_maintenance_id: string }
        Returns: boolean
      }
      delete_motorcycle_with_purchase: {
        Args: { p_motorcycle_id: string }
        Returns: boolean
      }
      delete_vehicle_maintenance_with_finance: {
        Args: { p_maintenance_id: string }
        Returns: boolean
      }
      delete_vehicle_with_purchase: {
        Args: { p_vehicle_id: string }
        Returns: boolean
      }
      detect_client_duplicates: {
        Args: { p_client: Json; p_exclude_client_id?: string }
        Returns: {
          client_number: string
          display_name: string
          email: string | null
          id: string
          legal_name: string | null
          matched_fields: string[]
          name_similarity: number
          registration_identifier_type: string | null
          registration_identifier_value: string | null
          telephone: string | null
        }[]
      }
      document_is_sensitive: {
        Args: { p_document_id: string }
        Returns: boolean
      }
      finance_create_operation: {
        Args: {
          p_link_module?: string
          p_link_record_id?: string
          p_operation: Json
        }
        Returns: {
          amount: number
          attachment_url: string | null
          category: string | null
          client: string | null
          contract_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          destination_wallet_id: string | null
          driver_id: string | null
          employee: string | null
          employee_id: string | null
          farm_id: string | null
          harvest_id: string | null
          id: string
          inventory_item_id: string | null
          maintenance_id: string | null
          module: string | null
          module_id: string | null
          motorcycle_id: string | null
          motorcycle_maintenance_id: string | null
          notes: string | null
          operation_date: string
          origin: string | null
          payment_method: string | null
          payment_reference: string | null
          project: string | null
          reference: string | null
          status: string | null
          supplier: string | null
          type: string
          updated_at: string | null
          vehicle_id: string | null
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "finance_operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finance_delete_operation: {
        Args: { p_operation_id: string }
        Returns: boolean
      }
      assign_field_wallet: {
        Args: { p_assignment: Json }
        Returns: FieldWalletAssignmentRow
        SetofOptions: { from: "*"; to: "field_wallet_assignments"; isOneToOne: true; isSetofReturn: false }
      }
      create_field_report: {
        Args: { p_report: Json }
        Returns: FieldReportRow
        SetofOptions: { from: "*"; to: "field_reports"; isOneToOne: true; isSetofReturn: false }
      }
      create_field_declaration: {
        Args: { p_report_id: string; p_declaration: Json }
        Returns: FieldDeclarationRow
        SetofOptions: { from: "*"; to: "field_declarations"; isOneToOne: true; isSetofReturn: false }
      }
      submit_field_report: {
        Args: { p_report_id: string }
        Returns: FieldReportRow
        SetofOptions: { from: "*"; to: "field_reports"; isOneToOne: true; isSetofReturn: false }
      }
      confirm_field_declaration: {
        Args: { p_declaration_id: string }
        Returns: FieldDeclarationRow
        SetofOptions: { from: "*"; to: "field_declarations"; isOneToOne: true; isSetofReturn: false }
      }
      reject_field_declaration: {
        Args: { p_declaration_id: string; p_reason: string }
        Returns: FieldDeclarationRow
        SetofOptions: { from: "*"; to: "field_declarations"; isOneToOne: true; isSetofReturn: false }
      }
      finance_require_write_role: { Args: never; Returns: undefined }
      finance_update_operation: {
        Args: { p_operation_id: string; p_values: Json }
        Returns: {
          amount: number
          attachment_url: string | null
          category: string | null
          client: string | null
          contract_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          destination_wallet_id: string | null
          driver_id: string | null
          employee: string | null
          employee_id: string | null
          farm_id: string | null
          harvest_id: string | null
          id: string
          inventory_item_id: string | null
          maintenance_id: string | null
          module: string | null
          module_id: string | null
          motorcycle_id: string | null
          motorcycle_maintenance_id: string | null
          notes: string | null
          operation_date: string
          origin: string | null
          payment_method: string | null
          payment_reference: string | null
          project: string | null
          reference: string | null
          status: string | null
          supplier: string | null
          type: string
          updated_at: string | null
          vehicle_id: string | null
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "finance_operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_configured_notifications: { Args: never; Returns: number }
      generate_notifications: { Args: never; Returns: number }
      generate_notifications_dashboard_fallback: {
        Args: never
        Returns: {
          completed_at: string | null
          created_count: number
          error_count: number
          error_message: string | null
          id: string
          resolved_count: number
          started_at: string
          status: string
          trigger_type: string
          triggered_by: string | null
          updated_count: number
        }
        SetofOptions: {
          from: "*"
          to: "notification_generation_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_document_audit_history: {
        Args: { p_document_id: string }
        Returns: {
          action: string
          after_value: Json | null
          before_value: Json | null
          created_at: string
          id: string
          operation_id: string | null
          performed_by: string | null
          source_id: string
          source_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "business_finance_audit"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_client_audit_history: {
        Args: { p_client_id: string }
        Returns: {
          action: string
          after_value: Json | null
          before_value: Json | null
          created_at: string
          id: string
          performed_by: string | null
        }[]
      }
      get_client_financial_metrics: {
        Args: { p_client_id: string }
        Returns: {
          amount_due: number | null
          cash_result: number | null
          gross_result: number | null
          last_mission_at: string | null
          last_payment_at: string | null
          metrics_available: boolean
          mission_count: number | null
          total_billed: number | null
          total_expenses: number | null
          total_received: number | null
        }[]
      }
      get_management_report: {
        Args: { p_filters?: Json; p_report_type: string }
        Returns: Json
      }
      get_management_report_operations: {
        Args: { p_filters?: Json; p_page?: number; p_page_size?: number }
        Returns: {
          amount: number
          category: string
          description: string
          destination_wallet_name: string
          id: string
          operation_date: string
          source_label: string
          source_route: string
          status: string
          total_count: number
          type: string
          wallet_name: string
        }[]
      }
      get_management_treasury_report: {
        Args: { p_filters?: Json }
        Returns: Json
      }
      get_permission_administration: { Args: never; Returns: Json }
      get_salary_payment_people: {
        Args: never
        Returns: {
          driver_id: string
          employee_id: string
          nom: string
          prenom: string
        }[]
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      merge_clients: {
        Args: { p_reason: string; p_source_client_id: string; p_target_client_id: string }
        Returns: Database["public"]["Tables"]["transport_clients"]["Row"]
        SetofOptions: {
          from: "*"
          to: "transport_clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notification_business_date: { Args: never; Returns: string }
      notification_rule_severity: {
        Args: { p_alert_type: string; p_due_date?: string }
        Returns: string
      }
      notification_scheduler_status: {
        Args: never
        Returns: {
          cron_expression: string
          job_id: number
          scheduler_configured: boolean
        }[]
      }
      permission_require: {
        Args: { p_permission_code: string }
        Returns: undefined
      }
      record_document_storage_cleanup: {
        Args: { p_result: string; p_storage_path: string }
        Returns: undefined
      }
      record_reporting_export: {
        Args: { p_report_type: string; p_row_count: number }
        Returns: undefined
      }
      replace_document_metadata: {
        Args: { p_document_id: string; p_nom?: string; p_storage_path: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          storage_path: string | null
          type: string | null
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reporting_can_access_report: {
        Args: { p_report_type: string }
        Returns: boolean
      }
      resolve_configured_notifications: { Args: never; Returns: number }
      resolve_obsolete_notifications: { Args: never; Returns: number }
      restore_document: {
        Args: { p_document_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_kind"] | null
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          storage_path: string | null
          type: string | null
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_client: {
        Args: { p_client_id: string }
        Returns: Database["public"]["Tables"]["transport_clients"]["Row"]
        SetofOptions: {
          from: "*"
          to: "transport_clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_notification_generation: {
        Args: { p_trigger_type?: string; p_triggered_by?: string }
        Returns: {
          completed_at: string | null
          created_count: number
          error_count: number
          error_message: string | null
          id: string
          resolved_count: number
          started_at: string
          status: string
          trigger_type: string
          triggered_by: string | null
          updated_count: number
        }
        SetofOptions: {
          from: "*"
          to: "notification_generation_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_notification_alert_rule: {
        Args: {
          p_alert_type: string
          p_default_severity: string
          p_due_days: number[]
          p_enabled: boolean
          p_recipient_roles: Database["public"]["Enums"]["app_role"][]
          p_severity_schedule: Json
          p_threshold: number | null
        }
        Returns: {
          alert_type: string
          created_at: string
          default_severity: string
          description: string | null
          due_days: number[]
          enabled: boolean
          id: string
          recipient_roles: Database["public"]["Enums"]["app_role"][]
          severity_schedule: Json
          threshold: number | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "notification_alert_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_notification_general_settings: {
        Args: { p_daily_run_time: string; p_timezone: string }
        Returns: {
          adresse: string | null
          created_at: string
          devise: string
          id: string
          logo_url: string | null
          nom: string
          notification_daily_run_time: string
          notion_sync_enabled: boolean
          notion_workspace_id: string | null
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "company_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      security_require_finance_role: { Args: never; Returns: undefined }
      set_inventory_alert_threshold: {
        Args: { p_alert_threshold: number; p_inventory_item_id: string }
        Returns: {
          categorie: string | null
          created_at: string
          id: string
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          seuil_alerte: number | null
          sku: string | null
          stock_actuel: number
          unite: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_role_permissions: {
        Args: {
          p_permission_codes: string[]
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: undefined
      }
      set_user_role: {
        Args: {
          p_assigned: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      set_wallet_alert_threshold: {
        Args: { p_alert_threshold: number | null; p_wallet_id: string }
        Returns: {
          alert_threshold: number | null
          balance: number | null
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          initial_balance: number
          is_default: boolean | null
          name: string
          type: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stock_movement_delta: {
        Args: { p_movement_type: string; p_quantity: number }
        Returns: number
      }
      sync_notification_daily_schedule: { Args: never; Returns: boolean }
      update_harvest_with_finance: {
        Args: { p_harvest: Json }
        Returns: {
          acheteur: string | null
          created_at: string
          date_recolte: string
          farm_id: string
          id: string
          montant_total: number | null
          observations: string | null
          prix_kg: number
          produit: string
          quantite_kg: number
          sale_wallet_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "harvests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_client: {
        Args: { p_client_id: string; p_values: Json }
        Returns: Database["public"]["Tables"]["transport_clients"]["Row"]
        SetofOptions: {
          from: "*"
          to: "transport_clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_motorcycle_maintenance_with_finance: {
        Args: { p_maintenance: Json }
        Returns: {
          cost: number | null
          created_at: string | null
          description: string | null
          garage: string | null
          id: string
          kilometrage: number | null
          maintenance_date: string
          motorcycle_id: string
          next_date: string | null
          next_kilometrage: number | null
          type: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "motorcycle_maintenances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_motorcycle_with_purchase: {
        Args: { p_motorcycle: Json }
        Returns: {
          annee: number | null
          assurance_expiration: string | null
          couleur: string | null
          created_at: string
          date_achat: string | null
          derniere_revision: string | null
          driver_id: string | null
          id: string
          immatriculation: string
          kilometrage: number | null
          marque: string | null
          modele: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          observations: string | null
          prix_achat: number | null
          prochaine_revision: string | null
          purchase_wallet_id: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          updated_at: string
          visite_expiration: string | null
        }
        SetofOptions: {
          from: "*"
          to: "motorcycles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_notification_status: {
        Args: {
          p_notification_id: string
          p_snoozed_until?: string
          p_status: string
        }
        Returns: {
          created_at: string
          deduplication_key: string | null
          due_date: string | null
          entity_route: string | null
          id: string
          lu: boolean
          message: string | null
          read_at: string | null
          resolved_at: string | null
          severity: string
          snoozed_until: string | null
          status: string
          titre: string
          type: string | null
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_salary_payment_with_finance: {
        Args: { p_payment: Json }
        Returns: {
          amount: number
          contract_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          driver_id: string | null
          employee_id: string
          id: string
          is_partial: boolean
          paid_at: string
          period_start: string
          reference: string | null
          status: string
          updated_at: string
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "salary_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_stock_movement_with_finance: {
        Args: { p_movement: Json }
        Returns: {
          client: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          inventory_item_id: string
          movement_date: string
          movement_type: string
          quantity: number
          reference: string | null
          status: string
          supplier: string | null
          unit_price: number | null
          updated_at: string
          wallet_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_vehicle_maintenance_with_finance: {
        Args: { p_maintenance: Json }
        Returns: {
          cout: number | null
          created_at: string
          date: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["entity_kind"]
          id: string
          kilometrage: number | null
          notes: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          prestataire: string | null
          type: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "maintenances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_vehicle_with_purchase: {
        Args: { p_vehicle: Json }
        Returns: {
          brand: string | null
          chassis_number: string | null
          color: string | null
          created_at: string
          description: string | null
          driver_id: string | null
          engine_number: string | null
          id: string
          kilometrage: number | null
          model: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          photo_url: string | null
          purchase_date: string | null
          purchase_price: number | null
          purchase_wallet_id: string | null
          registration: string
          status: string | null
          supplier: string | null
          type: string | null
          updated_at: string
          year: number | null
        }
        SetofOptions: {
          from: "*"
          to: "vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_transport_mission: { Args: { p_mission: Json }; Returns: TransportMissionRow; SetofOptions: { from: "transport_missions"; to: "transport_missions"; isOneToOne: true; isSetofReturn: false } }
      delete_transport_mission: { Args: { p_mission_id: string }; Returns: boolean }
      update_transport_mission: { Args: { p_mission_id: string; p_values: Json }; Returns: TransportMissionRow; SetofOptions: { from: "transport_missions"; to: "transport_missions"; isOneToOne: true; isSetofReturn: false } }
      set_transport_mission_status: { Args: { p_mission_id: string; p_status: string; p_reason?: string | null }; Returns: TransportMissionRow; SetofOptions: { from: "transport_missions"; to: "transport_missions"; isOneToOne: true; isSetofReturn: false } }
      create_transport_mission_budget_line: { Args: { p_mission_id: string; p_line: Json }; Returns: TransportBudgetLineRow; SetofOptions: { from: "transport_mission_budget_lines"; to: "transport_mission_budget_lines"; isOneToOne: true; isSetofReturn: false } }
      create_transport_mission_expense: { Args: { p_mission_id: string; p_expense: Json }; Returns: TransportExpenseRow; SetofOptions: { from: "transport_mission_expenses"; to: "transport_mission_expenses"; isOneToOne: true; isSetofReturn: false } }
      update_transport_mission_expense: { Args: { p_expense_id: string; p_values: Json }; Returns: TransportExpenseRow; SetofOptions: { from: "transport_mission_expenses"; to: "transport_mission_expenses"; isOneToOne: true; isSetofReturn: false } }
      confirm_transport_mission_expense: { Args: { p_expense_id: string }; Returns: TransportExpenseRow; SetofOptions: { from: "transport_mission_expenses"; to: "transport_mission_expenses"; isOneToOne: true; isSetofReturn: false } }
      cancel_transport_mission_expense: { Args: { p_expense_id: string; p_reason: string }; Returns: TransportExpenseRow; SetofOptions: { from: "transport_mission_expenses"; to: "transport_mission_expenses"; isOneToOne: true; isSetofReturn: false } }
      create_transport_invoice: { Args: { p_mission_id: string; p_invoice: Json }; Returns: TransportInvoiceRow; SetofOptions: { from: "transport_invoices"; to: "transport_invoices"; isOneToOne: true; isSetofReturn: false } }
      issue_transport_invoice: { Args: { p_invoice_id: string }; Returns: TransportInvoiceRow; SetofOptions: { from: "transport_invoices"; to: "transport_invoices"; isOneToOne: true; isSetofReturn: false } }
      create_transport_invoice_payment: { Args: { p_invoice_id: string; p_payment: Json }; Returns: TransportPaymentRow; SetofOptions: { from: "transport_invoice_payments"; to: "transport_invoice_payments"; isOneToOne: true; isSetofReturn: false } }
      confirm_transport_invoice_payment: { Args: { p_payment_id: string }; Returns: TransportPaymentRow; SetofOptions: { from: "transport_invoice_payments"; to: "transport_invoice_payments"; isOneToOne: true; isSetofReturn: false } }
      cancel_transport_invoice_payment: { Args: { p_payment_id: string; p_reason: string }; Returns: TransportPaymentRow; SetofOptions: { from: "transport_invoice_payments"; to: "transport_invoice_payments"; isOneToOne: true; isSetofReturn: false } }
      get_transport_mission_financial_summary: { Args: { p_mission_id: string }; Returns: { quoted_amount: number; budget_amount: number; actual_expenses: number; invoiced_amount: number; received_amount: number; amount_due: number; gross_result: number; cash_result: number; cost_per_km: number | null }[] }
      get_transport_mission_history: { Args: { p_mission_id: string }; Returns: { id: string; source_type: string; source_id: string; action: string; created_at: string; performed_by: string | null; before_value: Json | null; after_value: Json | null }[] }
      update_wallet_balance: {
        Args: { p_wallet_id: string }
        Returns: undefined
      }
      user_has_all_permissions: {
        Args: { p_permission_codes: string[] }
        Returns: boolean
      }
      user_has_any_permission: {
        Args: { p_permission_codes: string[] }
        Returns: boolean
      }
      user_has_permission: {
        Args: { p_permission_code: string }
        Returns: boolean
      }
      wallet_create: {
        Args: { p_wallet: Json }
        Returns: {
          alert_threshold: number | null
          balance: number | null
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          initial_balance: number
          is_default: boolean | null
          name: string
          type: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wallet_delete: { Args: { p_wallet_id: string }; Returns: boolean }
      wallet_update: {
        Args: { p_values: Json; p_wallet_id: string }
        Returns: {
          alert_threshold: number | null
          balance: number | null
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          initial_balance: number
          is_default: boolean | null
          name: string
          type: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "gestionnaire"
        | "comptable"
        | "chauffeur"
        | "employe"
        | "lecture_seule"
        | "rh"
        | "operations"
        | "stocks"
        | "exploitations"
      entity_kind:
        | "employe"
        | "chauffeur"
        | "moto"
        | "vehicule"
        | "exploitation"
        | "contrat"
        | "autre"
      statut_general:
        | "actif"
        | "inactif"
        | "archive"
        | "en_service"
        | "en_reparation"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "gestionnaire",
        "comptable",
        "chauffeur",
        "employe",
        "lecture_seule",
        "rh",
        "operations",
        "stocks",
        "exploitations",
      ],
      entity_kind: [
        "employe",
        "chauffeur",
        "moto",
        "vehicule",
        "exploitation",
        "contrat",
        "autre",
      ],
      statut_general: [
        "actif",
        "inactif",
        "archive",
        "en_service",
        "en_reparation",
      ],
    },
  },
} as const
