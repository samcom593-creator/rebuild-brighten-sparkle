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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          threshold_type: string | null
          threshold_value: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          threshold_type?: string | null
          threshold_value?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          threshold_type?: string | null
          threshold_value?: number | null
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      agent_achievements: {
        Row: {
          achievement_id: string
          agent_id: string
          earned_at: string
          id: string
        }
        Insert: {
          achievement_id: string
          agent_id: string
          earned_at?: string
          id?: string
        }
        Update: {
          achievement_id?: string
          agent_id?: string
          earned_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_achievements_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_lead_stats: {
        Row: {
          agent_id: string
          closed: number | null
          contacted: number | null
          created_at: string
          id: string
          licensed_count: number | null
          period_date: string
          period_type: string
          qualified: number | null
          total_leads: number | null
          unlicensed_count: number | null
        }
        Insert: {
          agent_id: string
          closed?: number | null
          contacted?: number | null
          created_at?: string
          id?: string
          licensed_count?: number | null
          period_date: string
          period_type: string
          qualified?: number | null
          total_leads?: number | null
          unlicensed_count?: number | null
        }
        Update: {
          agent_id?: string
          closed?: number | null
          contacted?: number | null
          created_at?: string
          id?: string
          licensed_count?: number | null
          period_date?: string
          period_type?: string
          qualified?: number | null
          total_leads?: number | null
          unlicensed_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_lead_stats_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_metrics: {
        Row: {
          agent_id: string
          appointments_set: number | null
          close_rate: number | null
          created_at: string
          earnings: number | null
          id: string
          leads_generated: number | null
          period_end: string
          period_start: string
          policies_sold: number | null
          premium_volume: number | null
        }
        Insert: {
          agent_id: string
          appointments_set?: number | null
          close_rate?: number | null
          created_at?: string
          earnings?: number | null
          id?: string
          leads_generated?: number | null
          period_end: string
          period_start: string
          policies_sold?: number | null
          premium_volume?: number | null
        }
        Update: {
          agent_id?: string
          appointments_set?: number | null
          close_rate?: number | null
          created_at?: string
          earnings?: number | null
          id?: string
          leads_generated?: number | null
          period_end?: string
          period_start?: string
          policies_sold?: number | null
          premium_volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_metrics_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_onboarding: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          notes: string | null
          stage: Database["public"]["Enums"]["onboarding_stage"]
          stage_completed_at: string | null
          stage_started_at: string
          updated_by: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          notes?: string | null
          stage: Database["public"]["Enums"]["onboarding_stage"]
          stage_completed_at?: string | null
          stage_started_at?: string
          updated_by?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          stage?: Database["public"]["Enums"]["onboarding_stage"]
          stage_completed_at?: string | null
          stage_started_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_onboarding_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          agent_code: string | null
          created_at: string
          id: string
          invited_by_manager_id: string | null
          license_states: string[] | null
          license_status: Database["public"]["Enums"]["license_status"]
          manager_id: string | null
          nipr_number: string | null
          onboarding_completed_at: string | null
          onboarding_stage:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          profile_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["agent_status"]
          total_earnings: number | null
          total_policies: number | null
          total_premium: number | null
          updated_at: string
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          agent_code?: string | null
          created_at?: string
          id?: string
          invited_by_manager_id?: string | null
          license_states?: string[] | null
          license_status?: Database["public"]["Enums"]["license_status"]
          manager_id?: string | null
          nipr_number?: string | null
          onboarding_completed_at?: string | null
          onboarding_stage?:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          profile_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["agent_status"]
          total_earnings?: number | null
          total_policies?: number | null
          total_premium?: number | null
          updated_at?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          agent_code?: string | null
          created_at?: string
          id?: string
          invited_by_manager_id?: string | null
          license_states?: string[] | null
          license_status?: Database["public"]["Enums"]["license_status"]
          manager_id?: string | null
          nipr_number?: string | null
          onboarding_completed_at?: string | null
          onboarding_stage?:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          profile_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["agent_status"]
          total_earnings?: number | null
          total_policies?: number | null
          total_premium?: number | null
          updated_at?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_invited_by_manager_id_fkey"
            columns: ["invited_by_manager_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          priority: string | null
          published_at: string | null
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          priority?: string | null
          published_at?: string | null
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          priority?: string | null
          published_at?: string | null
          title?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          assigned_agent_id: string | null
          availability: string | null
          city: string | null
          closed_at: string | null
          contacted_at: string | null
          created_at: string
          desired_income: number | null
          email: string
          first_name: string
          followup_licensed_sent_at: string | null
          followup_sent_at: string | null
          has_insurance_experience: boolean | null
          id: string
          instagram_handle: string | null
          last_name: string
          license_doc_url: string | null
          license_status: Database["public"]["Enums"]["license_status"]
          licensed_states: string[] | null
          nipr_number: string | null
          notes: string | null
          phone: string
          previous_company: string | null
          previous_production: number | null
          qualified_at: string | null
          referral_source: string | null
          resume_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string | null
          started_training: boolean | null
          state: string | null
          status: Database["public"]["Enums"]["application_status"]
          terminated_at: string | null
          termination_reason: string | null
          updated_at: string
          years_experience: number | null
        }
        Insert: {
          assigned_agent_id?: string | null
          availability?: string | null
          city?: string | null
          closed_at?: string | null
          contacted_at?: string | null
          created_at?: string
          desired_income?: number | null
          email: string
          first_name: string
          followup_licensed_sent_at?: string | null
          followup_sent_at?: string | null
          has_insurance_experience?: boolean | null
          id?: string
          instagram_handle?: string | null
          last_name: string
          license_doc_url?: string | null
          license_status?: Database["public"]["Enums"]["license_status"]
          licensed_states?: string[] | null
          nipr_number?: string | null
          notes?: string | null
          phone: string
          previous_company?: string | null
          previous_production?: number | null
          qualified_at?: string | null
          referral_source?: string | null
          resume_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string | null
          started_training?: boolean | null
          state?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          terminated_at?: string | null
          termination_reason?: string | null
          updated_at?: string
          years_experience?: number | null
        }
        Update: {
          assigned_agent_id?: string | null
          availability?: string | null
          city?: string | null
          closed_at?: string | null
          contacted_at?: string | null
          created_at?: string
          desired_income?: number | null
          email?: string
          first_name?: string
          followup_licensed_sent_at?: string | null
          followup_sent_at?: string | null
          has_insurance_experience?: boolean | null
          id?: string
          instagram_handle?: string | null
          last_name?: string
          license_doc_url?: string | null
          license_status?: Database["public"]["Enums"]["license_status"]
          licensed_states?: string[] | null
          nipr_number?: string | null
          notes?: string | null
          phone?: string
          previous_company?: string | null
          previous_production?: number | null
          qualified_at?: string | null
          referral_source?: string | null
          resume_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string | null
          started_training?: boolean | null
          state?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          terminated_at?: string | null
          termination_reason?: string | null
          updated_at?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_recordings: {
        Row: {
          agent_id: string | null
          application_id: string
          created_at: string | null
          duration_seconds: number | null
          id: string
          transcription: string | null
        }
        Insert: {
          agent_id?: string | null
          application_id: string
          created_at?: string | null
          duration_seconds?: number | null
          id?: string
          transcription?: string | null
        }
        Update: {
          agent_id?: string | null
          application_id?: string
          created_at?: string | null
          duration_seconds?: number | null
          id?: string
          transcription?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_recordings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_recordings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_counter: {
        Row: {
          count: number
          id: string
          updated_at: string
        }
        Insert: {
          count?: number
          id?: string
          updated_at?: string
        }
        Update: {
          count?: number
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      manager_invite_links: {
        Row: {
          created_at: string
          id: string
          invite_code: string
          is_active: boolean
          manager_agent_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_code: string
          is_active?: boolean
          manager_agent_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_code?: string
          is_active?: boolean
          manager_agent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_invite_links_manager_agent_id_fkey"
            columns: ["manager_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_signup_tokens: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          is_used: boolean
          manager_email: string | null
          manager_name: string | null
          token: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          is_used?: boolean
          manager_email?: string | null
          manager_name?: string | null
          token: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          is_used?: boolean
          manager_email?: string | null
          manager_name?: string | null
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      partial_applications: {
        Row: {
          admin_notified_at: string | null
          city: string | null
          converted_at: string | null
          created_at: string
          email: string | null
          first_name: string | null
          form_data: Json | null
          id: string
          ip_address: string | null
          last_name: string | null
          phone: string | null
          session_id: string
          state: string | null
          step_completed: number
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          admin_notified_at?: string | null
          city?: string | null
          converted_at?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          form_data?: Json | null
          id?: string
          ip_address?: string | null
          last_name?: string | null
          phone?: string | null
          session_id: string
          state?: string | null
          step_completed?: number
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          admin_notified_at?: string | null
          city?: string | null
          converted_at?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          form_data?: Json | null
          id?: string
          ip_address?: string | null
          last_name?: string | null
          phone?: string | null
          session_id?: string
          state?: string | null
          step_completed?: number
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          instagram_handle: string | null
          phone: string | null
          state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          instagram_handle?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          instagram_handle?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          category: string
          content: string | null
          created_at: string
          description: string | null
          id: string
          is_featured: boolean | null
          order_index: number | null
          thumbnail_url: string | null
          title: string
          type: string
          updated_at: string
          url: string | null
        }
        Insert: {
          category: string
          content?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_featured?: boolean | null
          order_index?: number | null
          thumbnail_url?: string | null
          title: string
          type: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          category?: string
          content?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_featured?: boolean | null
          order_index?: number | null
          thumbnail_url?: string | null
          title?: string
          type?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_agent_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      agent_status: "active" | "inactive" | "pending" | "terminated"
      app_role: "admin" | "manager" | "agent"
      application_status:
        | "new"
        | "reviewing"
        | "interview"
        | "contracting"
        | "approved"
        | "rejected"
      license_status: "licensed" | "unlicensed" | "pending"
      onboarding_stage:
        | "onboarding"
        | "training_online"
        | "in_field_training"
        | "evaluated"
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
      agent_status: ["active", "inactive", "pending", "terminated"],
      app_role: ["admin", "manager", "agent"],
      application_status: [
        "new",
        "reviewing",
        "interview",
        "contracting",
        "approved",
        "rejected",
      ],
      license_status: ["licensed", "unlicensed", "pending"],
      onboarding_stage: [
        "onboarding",
        "training_online",
        "in_field_training",
        "evaluated",
      ],
    },
  },
} as const
