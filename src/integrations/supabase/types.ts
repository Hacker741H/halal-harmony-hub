export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      company_settings: {
        Row: {
          adresse: string | null
          created_at: string
          devise: string
          id: string
          logo_url: string | null
          nom: string
          notion_sync_enabled: boolean
          notion_workspace_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          adresse?: string | null
          created_at?: string
          devise?: string
          id?: string
          logo_url?: string | null
          nom?: string
          notion_sync_enabled?: boolean
          notion_workspace_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          adresse?: string | null
          created_at?: string
          devise?: string
          id?: string
          logo_url?: string | null
          nom?: string
          notion_sync_enabled?: boolean
          notion_workspace_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
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
      documents: {
        Row: {
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
          type: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
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
          type?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
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
          type?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
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
          categorie: string | null
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
          paid_by: string | null
          updated_at: string
        }
        Insert: {
          categorie?: string | null
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
          paid_by?: string | null
          updated_at?: string
        }
        Update: {
          categorie?: string | null
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
          paid_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      farms: {
        Row: {
          created_at: string
          id: string
          localisation: string | null
          nom: string
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          superficie_ha: number | null
          type_culture: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          localisation?: string | null
          nom: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          superficie_ha?: number | null
          type_culture?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          localisation?: string | null
          nom?: string
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          superficie_ha?: number | null
          type_culture?: string | null
          updated_at?: string
        }
        Relationships: []
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
      motorcycles: {
        Row: {
          annee: number | null
          created_at: string
          driver_id: string | null
          id: string
          immatriculation: string
          kilometrage: number | null
          marque: string | null
          modele: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          updated_at: string
        }
        Insert: {
          annee?: number | null
          created_at?: string
          driver_id?: string | null
          id?: string
          immatriculation: string
          kilometrage?: number | null
          marque?: string | null
          modele?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          updated_at?: string
        }
        Update: {
          annee?: number | null
          created_at?: string
          driver_id?: string | null
          id?: string
          immatriculation?: string
          kilometrage?: number | null
          marque?: string | null
          modele?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "motorcycles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          lu: boolean
          message: string | null
          titre: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lu?: boolean
          message?: string | null
          titre: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lu?: boolean
          message?: string | null
          titre?: string
          type?: string | null
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          locale: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          phone?: string | null
          updated_at?: string
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
          annee: number | null
          created_at: string
          driver_id: string | null
          id: string
          immatriculation: string
          kilometrage: number | null
          marque: string | null
          modele: string | null
          notion_last_synced_at: string | null
          notion_page_id: string | null
          notion_workspace_id: string | null
          statut: Database["public"]["Enums"]["statut_general"]
          type: string | null
          updated_at: string
        }
        Insert: {
          annee?: number | null
          created_at?: string
          driver_id?: string | null
          id?: string
          immatriculation: string
          kilometrage?: number | null
          marque?: string | null
          modele?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          type?: string | null
          updated_at?: string
        }
        Update: {
          annee?: number | null
          created_at?: string
          driver_id?: string | null
          id?: string
          immatriculation?: string
          kilometrage?: number | null
          marque?: string | null
          modele?: string | null
          notion_last_synced_at?: string | null
          notion_page_id?: string | null
          notion_workspace_id?: string | null
          statut?: Database["public"]["Enums"]["statut_general"]
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
