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
      admin_calendar_blocks: {
        Row: {
          block_date: string
          category: string
          completed: boolean
          created_at: string
          end_hour: number
          id: string
          notes: string | null
          start_hour: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          block_date?: string
          category?: string
          completed?: boolean
          created_at?: string
          end_hour: number
          id?: string
          notes?: string | null
          start_hour: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          block_date?: string
          category?: string
          completed?: boolean
          created_at?: string
          end_hour?: number
          id?: string
          notes?: string | null
          start_hour?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      aged_leads: {
        Row: {
          about_me: string | null
          assigned_manager_id: string | null
          contacted_at: string | null
          created_at: string | null
          email: string | null
          first_name: string
          id: string
          instagram_handle: string | null
          last_contacted_at: string | null
          last_name: string | null
          lead_source: string | null
          license_status: string | null
          motivation: string | null
          notes: string | null
          original_date: string | null
          phone: string | null
          processed_at: string | null
          status: string | null
        }
        Insert: {
          about_me?: string | null
          assigned_manager_id?: string | null
          contacted_at?: string | null
          created_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          instagram_handle?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          lead_source?: string | null
          license_status?: string | null
          motivation?: string | null
          notes?: string | null
          original_date?: string | null
          phone?: string | null
          processed_at?: string | null
          status?: string | null
        }
        Update: {
          about_me?: string | null
          assigned_manager_id?: string | null
          contacted_at?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          instagram_handle?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          lead_source?: string | null
          license_status?: string | null
          motivation?: string | null
          notes?: string | null
          original_date?: string | null
          phone?: string | null
          processed_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aged_leads_assigned_manager_id_fkey"
            columns: ["assigned_manager_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "aged_leads_assigned_manager_id_fkey"
            columns: ["assigned_manager_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
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
      agent_attendance: {
        Row: {
          agent_id: string
          attendance_date: string
          attendance_type: Database["public"]["Enums"]["attendance_type"]
          created_at: string
          id: string
          marked_by: string | null
          status: Database["public"]["Enums"]["attendance_mark"]
          updated_at: string
        }
        Insert: {
          agent_id: string
          attendance_date: string
          attendance_type: Database["public"]["Enums"]["attendance_type"]
          created_at?: string
          id?: string
          marked_by?: string | null
          status?: Database["public"]["Enums"]["attendance_mark"]
          updated_at?: string
        }
        Update: {
          agent_id?: string
          attendance_date?: string
          attendance_type?: Database["public"]["Enums"]["attendance_type"]
          created_at?: string
          id?: string
          marked_by?: string | null
          status?: Database["public"]["Enums"]["attendance_mark"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_attendance_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_attendance_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_award_profiles: {
        Row: {
          agent_id: string
          created_at: string | null
          display_name_override: string | null
          id: string
          instagram_handle: string | null
          photo_url: string | null
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          display_name_override?: string | null
          id?: string
          instagram_handle?: string | null
          photo_url?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          display_name_override?: string | null
          id?: string
          instagram_handle?: string | null
          photo_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_award_profiles_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_award_profiles_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_carrier_comp: {
        Row: {
          agent_id: string
          carrier_id: string | null
          carrier_name: string
          contract_code: string | null
          contract_pct: number | null
          effective_pct: number | null
          id: string
          notes: string | null
          override_pct: number | null
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          carrier_id?: string | null
          carrier_name: string
          contract_code?: string | null
          contract_pct?: number | null
          effective_pct?: number | null
          id?: string
          notes?: string | null
          override_pct?: number | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          carrier_id?: string | null
          carrier_name?: string
          contract_code?: string | null
          contract_pct?: number | null
          effective_pct?: number | null
          id?: string
          notes?: string | null
          override_pct?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_carrier_comp_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_carrier_comp_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_carrier_comp_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_goals: {
        Row: {
          agent_id: string
          comp_percentage: number | null
          created_at: string | null
          id: string
          income_goal: number
          month_year: string
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          comp_percentage?: number | null
          created_at?: string | null
          id?: string
          income_goal: number
          month_year: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          comp_percentage?: number | null
          created_at?: string | null
          id?: string
          income_goal?: number
          month_year?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_goals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_goals_agent_id_fkey"
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
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
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
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_metrics_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_notes: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_notes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_notes_agent_id_fkey"
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
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_onboarding_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_ratings: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          rated_by: string
          rating: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          rated_by: string
          rating: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          rated_by?: string
          rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_ratings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_ratings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_removal_requests: {
        Row: {
          agent_id: string
          created_at: string | null
          id: string
          reason: string | null
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          id?: string
          reason?: string | null
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          id?: string
          reason?: string | null
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_removal_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_removal_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tasks: {
        Row: {
          agent_id: string
          agent_notes: string | null
          assigned_by: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: string | null
          status: string | null
          task_type: string | null
          title: string
        }
        Insert: {
          agent_id: string
          agent_notes?: string | null
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string | null
          status?: string | null
          task_type?: string | null
          title: string
        }
        Update: {
          agent_id?: string
          agent_notes?: string | null
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string | null
          status?: string | null
          task_type?: string | null
          title?: string
        }
        Relationships: []
      }
      agentlink_sync_log: {
        Row: {
          deals_inserted: number | null
          deals_updated: number | null
          error_message: string | null
          finished_at: string | null
          http_request_id: number | null
          id: string
          policies_seen: number | null
          started_at: string
          status: string
          upstream_status: number | null
        }
        Insert: {
          deals_inserted?: number | null
          deals_updated?: number | null
          error_message?: string | null
          finished_at?: string | null
          http_request_id?: number | null
          id?: string
          policies_seen?: number | null
          started_at?: string
          status?: string
          upstream_status?: number | null
        }
        Update: {
          deals_inserted?: number | null
          deals_updated?: number | null
          error_message?: string | null
          finished_at?: string | null
          http_request_id?: number | null
          id?: string
          policies_seen?: number | null
          started_at?: string
          status?: string
          upstream_status?: number | null
        }
        Relationships: []
      }
      agents: {
        Row: {
          agent_code: string | null
          attendance_status:
            | Database["public"]["Enums"]["attendance_status"]
            | null
          contract_percentage: number | null
          contracted_at: string | null
          created_at: string
          crm_setup_link: string | null
          deactivation_reason:
            | Database["public"]["Enums"]["deactivation_reason"]
            | null
          display_name: string | null
          evaluated_at: string | null
          evaluated_by: string | null
          evaluation_result: string | null
          field_training_started_at: string | null
          has_dialer_login: boolean | null
          has_discord_access: boolean | null
          has_production_access: boolean | null
          has_training_course: boolean | null
          id: string
          insuracloud_api_token: string | null
          insuracloud_user_id: number | null
          invited_by_manager_id: string | null
          is_deactivated: boolean | null
          is_inactive: boolean | null
          is_presenting: boolean
          license_states: string[] | null
          license_status: Database["public"]["Enums"]["license_status"]
          manager_id: string | null
          max_recruits: number | null
          nipr_number: string | null
          onboarding_completed_at: string | null
          onboarding_stage:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          override_rate: number | null
          password_required: boolean | null
          performance_tier:
            | Database["public"]["Enums"]["performance_tier"]
            | null
          portal_password_set: boolean | null
          potential_rating: number | null
          production_unlocked_at: string | null
          profile_id: string | null
          ref_slug: string | null
          sort_order: number | null
          stage_changed_at: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["agent_status"]
          switched_to_manager_id: string | null
          total_earnings: number | null
          total_policies: number | null
          total_premium: number | null
          updated_at: string
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
          weekly_10k_badges: number | null
        }
        Insert: {
          agent_code?: string | null
          attendance_status?:
            | Database["public"]["Enums"]["attendance_status"]
            | null
          contract_percentage?: number | null
          contracted_at?: string | null
          created_at?: string
          crm_setup_link?: string | null
          deactivation_reason?:
            | Database["public"]["Enums"]["deactivation_reason"]
            | null
          display_name?: string | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          evaluation_result?: string | null
          field_training_started_at?: string | null
          has_dialer_login?: boolean | null
          has_discord_access?: boolean | null
          has_production_access?: boolean | null
          has_training_course?: boolean | null
          id?: string
          insuracloud_api_token?: string | null
          insuracloud_user_id?: number | null
          invited_by_manager_id?: string | null
          is_deactivated?: boolean | null
          is_inactive?: boolean | null
          is_presenting?: boolean
          license_states?: string[] | null
          license_status?: Database["public"]["Enums"]["license_status"]
          manager_id?: string | null
          max_recruits?: number | null
          nipr_number?: string | null
          onboarding_completed_at?: string | null
          onboarding_stage?:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          override_rate?: number | null
          password_required?: boolean | null
          performance_tier?:
            | Database["public"]["Enums"]["performance_tier"]
            | null
          portal_password_set?: boolean | null
          potential_rating?: number | null
          production_unlocked_at?: string | null
          profile_id?: string | null
          ref_slug?: string | null
          sort_order?: number | null
          stage_changed_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["agent_status"]
          switched_to_manager_id?: string | null
          total_earnings?: number | null
          total_policies?: number | null
          total_premium?: number | null
          updated_at?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
          weekly_10k_badges?: number | null
        }
        Update: {
          agent_code?: string | null
          attendance_status?:
            | Database["public"]["Enums"]["attendance_status"]
            | null
          contract_percentage?: number | null
          contracted_at?: string | null
          created_at?: string
          crm_setup_link?: string | null
          deactivation_reason?:
            | Database["public"]["Enums"]["deactivation_reason"]
            | null
          display_name?: string | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          evaluation_result?: string | null
          field_training_started_at?: string | null
          has_dialer_login?: boolean | null
          has_discord_access?: boolean | null
          has_production_access?: boolean | null
          has_training_course?: boolean | null
          id?: string
          insuracloud_api_token?: string | null
          insuracloud_user_id?: number | null
          invited_by_manager_id?: string | null
          is_deactivated?: boolean | null
          is_inactive?: boolean | null
          is_presenting?: boolean
          license_states?: string[] | null
          license_status?: Database["public"]["Enums"]["license_status"]
          manager_id?: string | null
          max_recruits?: number | null
          nipr_number?: string | null
          onboarding_completed_at?: string | null
          onboarding_stage?:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          override_rate?: number | null
          password_required?: boolean | null
          performance_tier?:
            | Database["public"]["Enums"]["performance_tier"]
            | null
          portal_password_set?: boolean | null
          potential_rating?: number | null
          production_unlocked_at?: string | null
          profile_id?: string | null
          ref_slug?: string | null
          sort_order?: number | null
          stage_changed_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["agent_status"]
          switched_to_manager_id?: string | null
          total_earnings?: number | null
          total_policies?: number | null
          total_premium?: number | null
          updated_at?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
          weekly_10k_badges?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_invited_by_manager_id_fkey"
            columns: ["invited_by_manager_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
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
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
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
          {
            foreignKeyName: "agents_switched_to_manager_id_fkey"
            columns: ["switched_to_manager_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agents_switched_to_manager_id_fkey"
            columns: ["switched_to_manager_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          created_at: string
          event_category: string | null
          event_name: string
          id: string
          properties: Json | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_category?: string | null
          event_name: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_category?: string | null
          event_name?: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_02: {
        Row: {
          created_at: string
          event_category: string | null
          event_name: string
          id: string
          properties: Json | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_category?: string | null
          event_name: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_category?: string | null
          event_name?: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_03: {
        Row: {
          created_at: string
          event_category: string | null
          event_name: string
          id: string
          properties: Json | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_category?: string | null
          event_name: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_category?: string | null
          event_name?: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_04: {
        Row: {
          created_at: string
          event_category: string | null
          event_name: string
          id: string
          properties: Json | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_category?: string | null
          event_name: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_category?: string | null
          event_name?: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_05: {
        Row: {
          created_at: string
          event_category: string | null
          event_name: string
          id: string
          properties: Json | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_category?: string | null
          event_name: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_category?: string | null
          event_name?: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_06: {
        Row: {
          created_at: string
          event_category: string | null
          event_name: string
          id: string
          properties: Json | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_category?: string | null
          event_name: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_category?: string | null
          event_name?: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_07: {
        Row: {
          created_at: string
          event_category: string | null
          event_name: string
          id: string
          properties: Json | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_category?: string | null
          event_name: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_category?: string | null
          event_name?: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_default: {
        Row: {
          created_at: string
          event_category: string | null
          event_name: string
          id: string
          properties: Json | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_category?: string | null
          event_name: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_category?: string | null
          event_name?: string
          id?: string
          properties?: Json | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
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
      applicant_checkins: {
        Row: {
          application_id: string
          blocker: string | null
          checkin_date: string
          created_at: string
          help_notified_at: string | null
          id: string
          license_progress: string | null
          needs_help: boolean | null
          notes: string | null
          study_hours: number | null
          test_date: string | null
          test_scheduled: boolean | null
        }
        Insert: {
          application_id: string
          blocker?: string | null
          checkin_date?: string
          created_at?: string
          help_notified_at?: string | null
          id?: string
          license_progress?: string | null
          needs_help?: boolean | null
          notes?: string | null
          study_hours?: number | null
          test_date?: string | null
          test_scheduled?: boolean | null
        }
        Update: {
          application_id?: string
          blocker?: string | null
          checkin_date?: string
          created_at?: string
          help_notified_at?: string | null
          id?: string
          license_progress?: string | null
          needs_help?: boolean | null
          notes?: string | null
          study_hours?: number | null
          test_date?: string | null
          test_scheduled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "applicant_checkins_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          ai_score_tier: string | null
          assigned_agent_id: string | null
          availability: string | null
          carrier: string | null
          city: string | null
          closed_at: string | null
          consent_form_version: string | null
          consent_ip_address: string | null
          consent_source_url: string | null
          consent_timestamp_utc: string | null
          consent_user_agent: string | null
          contacted_at: string | null
          contracted_at: string | null
          course_purchased_at: string | null
          course_started_at: string | null
          created_at: string
          desired_income: number | null
          duplicate_of: string | null
          email: string
          email_consent_given: boolean | null
          email_consent_text: string | null
          exam_passed_at: string | null
          exam_scheduled_at: string | null
          fingerprint_date: string | null
          fingerprint_done: boolean | null
          fingerprints_submitted_at: string | null
          first_contact_attempt_at: string | null
          first_deal_at: string | null
          first_name: string
          followup_licensed_sent_at: string | null
          followup_sent_at: string | null
          followup_unlicensed_2_sent_at: string | null
          has_insurance_experience: boolean | null
          hiring_manager_user_id: string | null
          hiring_scope_at_intake:
            | Database["public"]["Enums"]["hiring_scope"]
            | null
          id: string
          instagram_handle: string | null
          is_duplicate: boolean | null
          is_ghosted: boolean | null
          is_transfer: boolean | null
          last_automated_email_at: string | null
          last_contacted_at: string | null
          last_name: string
          last_response_at: string | null
          lead_score: number | null
          license_approved_at: string | null
          license_doc_url: string | null
          license_progress:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status: Database["public"]["Enums"]["license_status"]
          licensed_at: string | null
          licensed_states: string[] | null
          manual_followup_sent_at: string | null
          next_action_at: string | null
          next_action_type: string | null
          nipr_number: string | null
          notes: string | null
          phone: string | null
          previous_company: string | null
          previous_production: number | null
          qualified_at: string | null
          recruiter_id: string | null
          referral_manager_id: string | null
          referral_source: string | null
          referral_source_detail: string | null
          resume_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sms_consent_given: boolean | null
          sms_consent_text: string | null
          start_date: string | null
          started_training: boolean | null
          state: string | null
          status: Database["public"]["Enums"]["application_status"]
          terminated_at: string | null
          termination_reason: string | null
          test_scheduled_date: string | null
          updated_at: string
          winback_sent_at: string | null
          years_experience: number | null
        }
        Insert: {
          ai_score_tier?: string | null
          assigned_agent_id?: string | null
          availability?: string | null
          carrier?: string | null
          city?: string | null
          closed_at?: string | null
          consent_form_version?: string | null
          consent_ip_address?: string | null
          consent_source_url?: string | null
          consent_timestamp_utc?: string | null
          consent_user_agent?: string | null
          contacted_at?: string | null
          contracted_at?: string | null
          course_purchased_at?: string | null
          course_started_at?: string | null
          created_at?: string
          desired_income?: number | null
          duplicate_of?: string | null
          email: string
          email_consent_given?: boolean | null
          email_consent_text?: string | null
          exam_passed_at?: string | null
          exam_scheduled_at?: string | null
          fingerprint_date?: string | null
          fingerprint_done?: boolean | null
          fingerprints_submitted_at?: string | null
          first_contact_attempt_at?: string | null
          first_deal_at?: string | null
          first_name: string
          followup_licensed_sent_at?: string | null
          followup_sent_at?: string | null
          followup_unlicensed_2_sent_at?: string | null
          has_insurance_experience?: boolean | null
          hiring_manager_user_id?: string | null
          hiring_scope_at_intake?:
            | Database["public"]["Enums"]["hiring_scope"]
            | null
          id?: string
          instagram_handle?: string | null
          is_duplicate?: boolean | null
          is_ghosted?: boolean | null
          is_transfer?: boolean | null
          last_automated_email_at?: string | null
          last_contacted_at?: string | null
          last_name: string
          last_response_at?: string | null
          lead_score?: number | null
          license_approved_at?: string | null
          license_doc_url?: string | null
          license_progress?:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status?: Database["public"]["Enums"]["license_status"]
          licensed_at?: string | null
          licensed_states?: string[] | null
          manual_followup_sent_at?: string | null
          next_action_at?: string | null
          next_action_type?: string | null
          nipr_number?: string | null
          notes?: string | null
          phone?: string | null
          previous_company?: string | null
          previous_production?: number | null
          qualified_at?: string | null
          recruiter_id?: string | null
          referral_manager_id?: string | null
          referral_source?: string | null
          referral_source_detail?: string | null
          resume_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sms_consent_given?: boolean | null
          sms_consent_text?: string | null
          start_date?: string | null
          started_training?: boolean | null
          state?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          terminated_at?: string | null
          termination_reason?: string | null
          test_scheduled_date?: string | null
          updated_at?: string
          winback_sent_at?: string | null
          years_experience?: number | null
        }
        Update: {
          ai_score_tier?: string | null
          assigned_agent_id?: string | null
          availability?: string | null
          carrier?: string | null
          city?: string | null
          closed_at?: string | null
          consent_form_version?: string | null
          consent_ip_address?: string | null
          consent_source_url?: string | null
          consent_timestamp_utc?: string | null
          consent_user_agent?: string | null
          contacted_at?: string | null
          contracted_at?: string | null
          course_purchased_at?: string | null
          course_started_at?: string | null
          created_at?: string
          desired_income?: number | null
          duplicate_of?: string | null
          email?: string
          email_consent_given?: boolean | null
          email_consent_text?: string | null
          exam_passed_at?: string | null
          exam_scheduled_at?: string | null
          fingerprint_date?: string | null
          fingerprint_done?: boolean | null
          fingerprints_submitted_at?: string | null
          first_contact_attempt_at?: string | null
          first_deal_at?: string | null
          first_name?: string
          followup_licensed_sent_at?: string | null
          followup_sent_at?: string | null
          followup_unlicensed_2_sent_at?: string | null
          has_insurance_experience?: boolean | null
          hiring_manager_user_id?: string | null
          hiring_scope_at_intake?:
            | Database["public"]["Enums"]["hiring_scope"]
            | null
          id?: string
          instagram_handle?: string | null
          is_duplicate?: boolean | null
          is_ghosted?: boolean | null
          is_transfer?: boolean | null
          last_automated_email_at?: string | null
          last_contacted_at?: string | null
          last_name?: string
          last_response_at?: string | null
          lead_score?: number | null
          license_approved_at?: string | null
          license_doc_url?: string | null
          license_progress?:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status?: Database["public"]["Enums"]["license_status"]
          licensed_at?: string | null
          licensed_states?: string[] | null
          manual_followup_sent_at?: string | null
          next_action_at?: string | null
          next_action_type?: string | null
          nipr_number?: string | null
          notes?: string | null
          phone?: string | null
          previous_company?: string | null
          previous_production?: number | null
          qualified_at?: string | null
          recruiter_id?: string | null
          referral_manager_id?: string | null
          referral_source?: string | null
          referral_source_detail?: string | null
          resume_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sms_consent_given?: boolean | null
          sms_consent_text?: string | null
          start_date?: string | null
          started_training?: boolean | null
          state?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          terminated_at?: string | null
          termination_reason?: string | null
          test_scheduled_date?: string | null
          updated_at?: string
          winback_sent_at?: string | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "applications_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "applications_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026_02: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026_03: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026_04: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026_05: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026_06: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026_07: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_default: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      automation_run_log: {
        Row: {
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          http_status: number | null
          id: string
          job_name: string
          response_body: Json | null
          status: string
          triggered_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: string
          job_name: string
          response_body?: Json | null
          status?: string
          triggered_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: string
          job_name?: string
          response_body?: Json | null
          status?: string
          triggered_at?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          agents_affected: number | null
          automation_name: string
          created_at: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          ran_at: string | null
          status: string | null
        }
        Insert: {
          agents_affected?: number | null
          automation_name: string
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ran_at?: string | null
          status?: string | null
        }
        Update: {
          agents_affected?: number | null
          automation_name?: string
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ran_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      automation_settings: {
        Row: {
          created_at: string | null
          description: string | null
          enabled: boolean | null
          id: string
          last_affected_count: number | null
          last_run_at: string | null
          last_status: string | null
          name: string
          schedule: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          last_affected_count?: number | null
          last_run_at?: string | null
          last_status?: string | null
          name: string
          schedule?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          last_affected_count?: number | null
          last_run_at?: string | null
          last_status?: string | null
          name?: string
          schedule?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      award_batches: {
        Row: {
          award_type: string
          created_at: string
          id: string
          leaderboard_file: string | null
          metric_type: string
          period_end: string | null
          period_start: string | null
          source_data: Json | null
          status: string
          time_period: string
          top_agents: Json | null
          top_producer_file: string | null
          winner_agent_id: string | null
          winner_amount: number | null
          winner_name: string | null
        }
        Insert: {
          award_type?: string
          created_at?: string
          id?: string
          leaderboard_file?: string | null
          metric_type?: string
          period_end?: string | null
          period_start?: string | null
          source_data?: Json | null
          status?: string
          time_period: string
          top_agents?: Json | null
          top_producer_file?: string | null
          winner_agent_id?: string | null
          winner_amount?: number | null
          winner_name?: string | null
        }
        Update: {
          award_type?: string
          created_at?: string
          id?: string
          leaderboard_file?: string | null
          metric_type?: string
          period_end?: string | null
          period_start?: string | null
          source_data?: Json | null
          status?: string
          time_period?: string
          top_agents?: Json | null
          top_producer_file?: string | null
          winner_agent_id?: string | null
          winner_amount?: number | null
          winner_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "award_batches_winner_agent_id_fkey"
            columns: ["winner_agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "award_batches_winner_agent_id_fkey"
            columns: ["winner_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      banned_prospects: {
        Row: {
          banned_by: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          reason: string | null
        }
        Insert: {
          banned_by?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          reason?: string | null
        }
        Update: {
          banned_by?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      bot_alerts: {
        Row: {
          action_link: string | null
          body: string
          channels: string[]
          created_at: string
          event_type: string
          id: string
          sent_at: string | null
          sent_email_id: string | null
          sent_sms_id: string | null
          severity: string
          sms_body: string | null
          source: string
          subject: string
        }
        Insert: {
          action_link?: string | null
          body: string
          channels?: string[]
          created_at?: string
          event_type: string
          id?: string
          sent_at?: string | null
          sent_email_id?: string | null
          sent_sms_id?: string | null
          severity?: string
          sms_body?: string | null
          source: string
          subject: string
        }
        Update: {
          action_link?: string | null
          body?: string
          channels?: string[]
          created_at?: string
          event_type?: string
          id?: string
          sent_at?: string | null
          sent_email_id?: string | null
          sent_sms_id?: string | null
          severity?: string
          sms_body?: string | null
          source?: string
          subject?: string
        }
        Relationships: []
      }
      bot_audits: {
        Row: {
          action: string | null
          action_link: string | null
          audit_name: string
          created_at: string
          detail: Json | null
          dispatched_at: string | null
          finding_count: number
          id: string
          resolved_at: string | null
          severity: string
          sub_bot: string
          summary: string
        }
        Insert: {
          action?: string | null
          action_link?: string | null
          audit_name: string
          created_at?: string
          detail?: Json | null
          dispatched_at?: string | null
          finding_count?: number
          id?: string
          resolved_at?: string | null
          severity?: string
          sub_bot: string
          summary: string
        }
        Update: {
          action?: string | null
          action_link?: string | null
          audit_name?: string
          created_at?: string
          detail?: Json | null
          dispatched_at?: string | null
          finding_count?: number
          id?: string
          resolved_at?: string | null
          severity?: string
          sub_bot?: string
          summary?: string
        }
        Relationships: []
      }
      bot_metrics_snapshots: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          metric_key: string
          metric_value: number
          snapshot_date: string
          sub_bot: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          metric_key: string
          metric_value: number
          snapshot_date: string
          sub_bot?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          metric_key?: string
          metric_value?: number
          snapshot_date?: string
          sub_bot?: string | null
        }
        Relationships: []
      }
      bot_priorities: {
        Row: {
          action_link: string | null
          body: string
          created_at: string
          for_date: string
          id: string
          metric_key: string | null
          metric_value: number | null
          rank: number
          sub_bot: string | null
          title: string
        }
        Insert: {
          action_link?: string | null
          body: string
          created_at?: string
          for_date: string
          id?: string
          metric_key?: string | null
          metric_value?: number | null
          rank: number
          sub_bot?: string | null
          title: string
        }
        Update: {
          action_link?: string | null
          body?: string
          created_at?: string
          for_date?: string
          id?: string
          metric_key?: string | null
          metric_value?: number | null
          rank?: number
          sub_bot?: string | null
          title?: string
        }
        Relationships: []
      }
      call_transcripts: {
        Row: {
          agent_id: string | null
          ai_model: string | null
          application_id: string | null
          audio_url: string | null
          call_outcome: string | null
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          id: string
          recorded_by: string | null
          sentiment: string | null
          status: string
          summary: string | null
          transcript: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          ai_model?: string | null
          application_id?: string | null
          audio_url?: string | null
          call_outcome?: string | null
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          recorded_by?: string | null
          sentiment?: string | null
          status?: string
          summary?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          ai_model?: string | null
          application_id?: string | null
          audio_url?: string | null
          call_outcome?: string | null
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          recorded_by?: string | null
          sentiment?: string | null
          status?: string
          summary?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_transcripts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "call_transcripts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_transcripts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          created_at: string
          id: string
          insuracloud_carrier_id: number | null
          is_active: boolean | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          insuracloud_carrier_id?: number | null
          is_active?: boolean | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          insuracloud_carrier_id?: number | null
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      churn_risk_alerts: {
        Row: {
          action_taken: string | null
          agent_id: string
          created_at: string
          id: string
          resolved_at: string | null
          resolved_by: string | null
          risk_factors: Json | null
          risk_score: number
          risk_tier: string
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          agent_id: string
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          risk_factors?: Json | null
          risk_score?: number
          risk_tier?: string
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          agent_id?: string
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          risk_factors?: Json | null
          risk_score?: number
          risk_tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "churn_risk_alerts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "churn_risk_alerts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_history: {
        Row: {
          agent_id: string | null
          application_id: string
          contact_type: string
          created_at: string
          email_template: string | null
          id: string
          notes: string | null
          subject: string | null
        }
        Insert: {
          agent_id?: string | null
          application_id: string
          contact_type: string
          created_at?: string
          email_template?: string | null
          id?: string
          notes?: string | null
          subject?: string | null
        }
        Update: {
          agent_id?: string | null
          application_id?: string
          contact_type?: string
          created_at?: string
          email_template?: string | null
          id?: string
          notes?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "contact_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      content_library: {
        Row: {
          ai_analyzed: boolean | null
          ai_analyzed_at: string | null
          ai_description: string | null
          ai_tags: string[] | null
          content_type: string | null
          created_at: string
          description: string | null
          duplicate_flagged: boolean | null
          file_size: number | null
          file_type: string
          height: number | null
          id: string
          is_private: boolean | null
          is_sensitive: boolean | null
          original_name: string | null
          possible_duplicate_of: string | null
          public_url: string | null
          search_vector: unknown
          sensitive_checked: boolean | null
          sensitive_flags: string[] | null
          sensitive_reason: string | null
          source: string | null
          storage_path: string
          tags: string[] | null
          title: string
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          ai_analyzed?: boolean | null
          ai_analyzed_at?: string | null
          ai_description?: string | null
          ai_tags?: string[] | null
          content_type?: string | null
          created_at?: string
          description?: string | null
          duplicate_flagged?: boolean | null
          file_size?: number | null
          file_type?: string
          height?: number | null
          id?: string
          is_private?: boolean | null
          is_sensitive?: boolean | null
          original_name?: string | null
          possible_duplicate_of?: string | null
          public_url?: string | null
          search_vector?: unknown
          sensitive_checked?: boolean | null
          sensitive_flags?: string[] | null
          sensitive_reason?: string | null
          source?: string | null
          storage_path: string
          tags?: string[] | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          ai_analyzed?: boolean | null
          ai_analyzed_at?: string | null
          ai_description?: string | null
          ai_tags?: string[] | null
          content_type?: string | null
          created_at?: string
          description?: string | null
          duplicate_flagged?: boolean | null
          file_size?: number | null
          file_type?: string
          height?: number | null
          id?: string
          is_private?: boolean | null
          is_sensitive?: boolean | null
          original_name?: string | null
          possible_duplicate_of?: string | null
          public_url?: string | null
          search_vector?: unknown
          sensitive_checked?: boolean | null
          sensitive_flags?: string[] | null
          sensitive_reason?: string | null
          source?: string | null
          storage_path?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_library_possible_duplicate_of_fkey"
            columns: ["possible_duplicate_of"]
            isOneToOne: false
            referencedRelation: "content_library"
            referencedColumns: ["id"]
          },
        ]
      }
      contracting_links: {
        Row: {
          created_at: string
          id: string
          manager_id: string
          name: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_id: string
          name: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_id?: string
          name?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracting_links_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "contracting_links_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_production: {
        Row: {
          agent_id: string
          aop: number
          booked_inhome_referrals: number
          closing_rate: number | null
          created_at: string
          deals_closed: number
          hours_called: number
          id: string
          passed_price: number
          presentations: number
          production_date: string
          referral_presentations: number
          referrals_caught: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          aop?: number
          booked_inhome_referrals?: number
          closing_rate?: number | null
          created_at?: string
          deals_closed?: number
          hours_called?: number
          id?: string
          passed_price?: number
          presentations?: number
          production_date?: string
          referral_presentations?: number
          referrals_caught?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          aop?: number
          booked_inhome_referrals?: number
          closing_rate?: number | null
          created_at?: string
          deals_closed?: number
          hours_called?: number
          id?: string
          passed_price?: number
          presentations?: number
          production_date?: string
          referral_presentations?: number
          referrals_caught?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_production_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "daily_production_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          completed_at: string | null
          email: string
          handled_by: string | null
          id: string
          notes: string | null
          reason: string | null
          requested_at: string | null
          status: string | null
        }
        Insert: {
          completed_at?: string | null
          email: string
          handled_by?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          requested_at?: string | null
          status?: string | null
        }
        Update: {
          completed_at?: string | null
          email?: string
          handled_by?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          requested_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      deal_sync_log: {
        Row: {
          created_at: string | null
          deal_id: string | null
          direction: string | null
          error: string | null
          event_type: string | null
          id: string
          payload: Json | null
          response: Json | null
        }
        Insert: {
          created_at?: string | null
          deal_id?: string | null
          direction?: string | null
          error?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          response?: Json | null
        }
        Update: {
          created_at?: string | null
          deal_id?: string | null
          direction?: string | null
          error?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          response?: Json | null
        }
        Relationships: []
      }
      deal_sync_queue: {
        Row: {
          attempts: number | null
          created_at: string | null
          deal_id: string
          direction: string | null
          id: string
          last_error: string | null
          status: string | null
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          deal_id: string
          direction?: string | null
          id?: string
          last_error?: string | null
          status?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          deal_id?: string
          direction?: string | null
          id?: string
          last_error?: string | null
          status?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      deals: {
        Row: {
          agent_id: string
          annual_premium: number
          carrier_id: string | null
          client_dob: string
          client_first_name: string
          client_last_name: string
          client_phone: string
          created_at: string
          effective_date: string
          external_deal_id: string | null
          face_amount: number
          id: string
          insuracloud_sync_error: string | null
          monthly_premium: number
          notes: string | null
          pipeline_stage: string | null
          policy_expiration_date: string | null
          policy_number: string
          policy_term_months: number | null
          product_sold: string
          source: string | null
          status: string | null
          synced_to_insuracloud_at: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          annual_premium: number
          carrier_id?: string | null
          client_dob: string
          client_first_name: string
          client_last_name: string
          client_phone: string
          created_at?: string
          effective_date: string
          external_deal_id?: string | null
          face_amount: number
          id?: string
          insuracloud_sync_error?: string | null
          monthly_premium: number
          notes?: string | null
          pipeline_stage?: string | null
          policy_expiration_date?: string | null
          policy_number: string
          policy_term_months?: number | null
          product_sold: string
          source?: string | null
          status?: string | null
          synced_to_insuracloud_at?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          annual_premium?: number
          carrier_id?: string | null
          client_dob?: string
          client_first_name?: string
          client_last_name?: string
          client_phone?: string
          created_at?: string
          effective_date?: string
          external_deal_id?: string | null
          face_amount?: number
          id?: string
          insuracloud_sync_error?: string | null
          monthly_premium?: number
          notes?: string | null
          pipeline_stage?: string | null
          policy_expiration_date?: string | null
          policy_number?: string
          policy_term_months?: number | null
          product_sold?: string
          source?: string | null
          status?: string | null
          synced_to_insuracloud_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "deals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_leads: {
        Row: {
          assigned_agent_id: string | null
          city: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string
          first_name: string
          id: string
          last_name: string | null
          license_status: string | null
          original_data: Json | null
          original_id: string
          phone: string | null
          reason: string | null
          source: string
          state: string | null
        }
        Insert: {
          assigned_agent_id?: string | null
          city?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email: string
          first_name: string
          id?: string
          last_name?: string | null
          license_status?: string | null
          original_data?: Json | null
          original_id: string
          phone?: string | null
          reason?: string | null
          source: string
          state?: string | null
        }
        Update: {
          assigned_agent_id?: string | null
          city?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string | null
          license_status?: string | null
          original_data?: Json | null
          original_id?: string
          phone?: string | null
          reason?: string | null
          source?: string
          state?: string | null
        }
        Relationships: []
      }
      duplicate_agent_flags: {
        Row: {
          agent_ids: string[]
          email: string | null
          flagged_at: string
          id: string
          phone: string | null
          reason: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          agent_ids: string[]
          email?: string | null
          flagged_at?: string
          id?: string
          phone?: string | null
          reason?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          agent_ids?: string[]
          email?: string | null
          flagged_at?: string
          id?: string
          phone?: string | null
          reason?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: []
      }
      elite_circle_waitlist: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          motivation: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          first_name: string
          id?: string
          last_name: string
          motivation?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          motivation?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      email_delivery_log: {
        Row: {
          agent_id: string | null
          bounced_at: string | null
          created_at: string
          delivered_at: string | null
          error: string | null
          id: string
          provider: string | null
          provider_message_id: string | null
          recipient_email: string
          related_record_id: string | null
          related_record_type: string | null
          retries: number | null
          sent_at: string | null
          status: string
          subject: string | null
          template: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          bounced_at?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient_email: string
          related_record_id?: string | null
          related_record_type?: string | null
          retries?: number | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          bounced_at?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string
          related_record_id?: string | null
          related_record_type?: string | null
          retries?: number | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "email_delivery_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      email_tracking: {
        Row: {
          agent_id: string | null
          created_at: string
          email_type: string
          id: string
          metadata: Json | null
          open_count: number | null
          opened_at: string | null
          recipient_email: string
          sent_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          email_type: string
          id?: string
          metadata?: Json | null
          open_count?: number | null
          opened_at?: string | null
          recipient_email: string
          sent_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          email_type?: string
          id?: string
          metadata?: Json | null
          open_count?: number | null
          opened_at?: string | null
          recipient_email?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_tracking_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "email_tracking_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          component_stack: string | null
          created_at: string
          error_message: string
          id: string
          url: string | null
          user_id: string | null
        }
        Insert: {
          component_stack?: string | null
          created_at?: string
          error_message: string
          id?: string
          url?: string | null
          user_id?: string | null
        }
        Update: {
          component_stack?: string | null
          created_at?: string
          error_message?: string
          id?: string
          url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      field_checkins: {
        Row: {
          agent_id: string
          checkin_date: string
          client_name: string
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          outcome: string
          synced: boolean
          updated_at: string
          voice_note_url: string | null
        }
        Insert: {
          agent_id: string
          checkin_date?: string
          client_name: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          outcome?: string
          synced?: boolean
          updated_at?: string
          voice_note_url?: string | null
        }
        Update: {
          agent_id?: string
          checkin_date?: string
          client_name?: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          outcome?: string
          synced?: boolean
          updated_at?: string
          voice_note_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_checkins_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "field_checkins_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      function_errors: {
        Row: {
          created_at: string
          error_message: string
          error_stack: string | null
          function_name: string
          id: string
          request_id: string | null
          request_payload: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message: string
          error_stack?: string | null
          function_name: string
          id?: string
          request_id?: string | null
          request_payload?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string
          error_stack?: string | null
          function_name?: string
          id?: string
          request_id?: string | null
          request_payload?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      getting_started_progress: {
        Row: {
          added_phone_number: string | null
          agent_id: string
          closed_first_deal: string | null
          completed_first_training: string | null
          completed_profile: string | null
          contracted_with_carriers: string | null
          created_at: string
          current_stage: string
          id: string
          joined_discord: string | null
          joined_whatsapp: string | null
          last_activity_at: string
          made_first_prospect_call: string | null
          notes: string | null
          passed_license_test: string | null
          ran_first_appointment: string | null
          received_license: string | null
          scheduled_license_test: string | null
          signed_ica: string | null
          stage_entered_at: string
          stalled_alert_sent_at: string | null
          submitted_fingerprints: string | null
          updated_at: string
          uploaded_id: string | null
          watched_welcome_video: string | null
        }
        Insert: {
          added_phone_number?: string | null
          agent_id: string
          closed_first_deal?: string | null
          completed_first_training?: string | null
          completed_profile?: string | null
          contracted_with_carriers?: string | null
          created_at?: string
          current_stage?: string
          id?: string
          joined_discord?: string | null
          joined_whatsapp?: string | null
          last_activity_at?: string
          made_first_prospect_call?: string | null
          notes?: string | null
          passed_license_test?: string | null
          ran_first_appointment?: string | null
          received_license?: string | null
          scheduled_license_test?: string | null
          signed_ica?: string | null
          stage_entered_at?: string
          stalled_alert_sent_at?: string | null
          submitted_fingerprints?: string | null
          updated_at?: string
          uploaded_id?: string | null
          watched_welcome_video?: string | null
        }
        Update: {
          added_phone_number?: string | null
          agent_id?: string
          closed_first_deal?: string | null
          completed_first_training?: string | null
          completed_profile?: string | null
          contracted_with_carriers?: string | null
          created_at?: string
          current_stage?: string
          id?: string
          joined_discord?: string | null
          joined_whatsapp?: string | null
          last_activity_at?: string
          made_first_prospect_call?: string | null
          notes?: string | null
          passed_license_test?: string | null
          ran_first_appointment?: string | null
          received_license?: string | null
          scheduled_license_test?: string | null
          signed_ica?: string | null
          stage_entered_at?: string
          stalled_alert_sent_at?: string | null
          submitted_fingerprints?: string | null
          updated_at?: string
          uploaded_id?: string | null
          watched_welcome_video?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "getting_started_progress_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "getting_started_progress_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      health_check_log: {
        Row: {
          check_name: string
          created_at: string
          error_message: string | null
          id: string
          response_time_ms: number
          status: string
        }
        Insert: {
          check_name: string
          created_at?: string
          error_message?: string | null
          id?: string
          response_time_ms?: number
          status: string
        }
        Update: {
          check_name?: string
          created_at?: string
          error_message?: string | null
          id?: string
          response_time_ms?: number
          status?: string
        }
        Relationships: []
      }
      hiring_manager_assignments: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          manager_display_name: string
          manager_user_id: string
          notes: string | null
          priority: number
          scope: Database["public"]["Enums"]["hiring_scope"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          manager_display_name: string
          manager_user_id: string
          notes?: string | null
          priority?: number
          scope: Database["public"]["Enums"]["hiring_scope"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          manager_display_name?: string
          manager_user_id?: string
          notes?: string | null
          priority?: number
          scope?: Database["public"]["Enums"]["hiring_scope"]
          updated_at?: string
        }
        Relationships: []
      }
      ics_feed_tokens: {
        Row: {
          created_at: string
          last_accessed_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_accessed_at?: string | null
          token?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_accessed_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          created_at: string
          expires_at: string
          function_name: string
          id: string
          idempotency_key: string
          response_payload: Json | null
          status_code: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          function_name: string
          id?: string
          idempotency_key: string
          response_payload?: Json | null
          status_code?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          function_name?: string
          id?: string
          idempotency_key?: string
          response_payload?: Json | null
          status_code?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      inactive_agent_queue: {
        Row: {
          agent_id: string
          assigned_recovery_manager: string | null
          created_at: string
          days_inactive: number
          detected_at: string
          id: string
          last_contact_attempt_at: string | null
          last_login_at: string | null
          last_production_date: string | null
          last_recovery_attempt_at: string | null
          reason: string
          recovery_attempts: number | null
          recovery_notes: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          assigned_recovery_manager?: string | null
          created_at?: string
          days_inactive?: number
          detected_at?: string
          id?: string
          last_contact_attempt_at?: string | null
          last_login_at?: string | null
          last_production_date?: string | null
          last_recovery_attempt_at?: string | null
          reason: string
          recovery_attempts?: number | null
          recovery_notes?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          assigned_recovery_manager?: string | null
          created_at?: string
          days_inactive?: number
          detected_at?: string
          id?: string
          last_contact_attempt_at?: string | null
          last_login_at?: string | null
          last_production_date?: string | null
          last_recovery_attempt_at?: string | null
          reason?: string
          recovery_attempts?: number | null
          recovery_notes?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inactive_agent_queue_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "inactive_agent_queue_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_messages: {
        Row: {
          application_id: string | null
          assigned_to: string | null
          auto_replied: boolean | null
          body: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          intent: string | null
          lead_score: number | null
          raw_payload: Json | null
          received_at: string
          replied_at: string | null
          sender_avatar: string | null
          sender_handle: string | null
          sender_name: string | null
          source: string
        }
        Insert: {
          application_id?: string | null
          assigned_to?: string | null
          auto_replied?: boolean | null
          body: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          intent?: string | null
          lead_score?: number | null
          raw_payload?: Json | null
          received_at?: string
          replied_at?: string | null
          sender_avatar?: string | null
          sender_handle?: string | null
          sender_name?: string | null
          source: string
        }
        Update: {
          application_id?: string | null
          assigned_to?: string | null
          auto_replied?: boolean | null
          body?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          intent?: string | null
          lead_score?: number | null
          raw_payload?: Json | null
          received_at?: string
          replied_at?: string | null
          sender_avatar?: string | null
          sender_handle?: string | null
          sender_name?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_connections: {
        Row: {
          access_token: string
          connected_at: string | null
          id: string
          instagram_user_id: string
          instagram_username: string | null
          last_used_at: string | null
          scopes: string[] | null
          token_expires_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          connected_at?: string | null
          id?: string
          instagram_user_id: string
          instagram_username?: string | null
          last_used_at?: string | null
          scopes?: string[] | null
          token_expires_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          connected_at?: string | null
          id?: string
          instagram_user_id?: string
          instagram_username?: string | null
          last_used_at?: string | null
          scopes?: string[] | null
          token_expires_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      instagram_dm_templates: {
        Row: {
          body: string
          category: string | null
          created_at: string | null
          id: string
          name: string
          updated_at: string | null
          use_count: number | null
          user_id: string
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string | null
          id?: string
          name: string
          updated_at?: string | null
          use_count?: number | null
          user_id: string
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          use_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      instagram_dm_threads: {
        Row: {
          bucket: string | null
          conversation_id: string | null
          display_name: string | null
          id: string
          ig_user_id: string
          last_msg_at: string | null
          last_msg_preview: string | null
          last_sender: string | null
          last_sent_at: string | null
          messages_count: number | null
          notes: string | null
          outreach_status: string | null
          profile_pic_url: string | null
          stage: string | null
          updated_at: string | null
          user_id: string
          username: string | null
        }
        Insert: {
          bucket?: string | null
          conversation_id?: string | null
          display_name?: string | null
          id?: string
          ig_user_id: string
          last_msg_at?: string | null
          last_msg_preview?: string | null
          last_sender?: string | null
          last_sent_at?: string | null
          messages_count?: number | null
          notes?: string | null
          outreach_status?: string | null
          profile_pic_url?: string | null
          stage?: string | null
          updated_at?: string | null
          user_id: string
          username?: string | null
        }
        Update: {
          bucket?: string | null
          conversation_id?: string | null
          display_name?: string | null
          id?: string
          ig_user_id?: string
          last_msg_at?: string | null
          last_msg_preview?: string | null
          last_sender?: string | null
          last_sent_at?: string | null
          messages_count?: number | null
          notes?: string | null
          outreach_status?: string | null
          profile_pic_url?: string | null
          stage?: string | null
          updated_at?: string | null
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      instagram_events: {
        Row: {
          created_at: string | null
          event_type: string | null
          external_id: string | null
          id: string
          payload: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type?: string | null
          external_id?: string | null
          id?: string
          payload?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string | null
          external_id?: string | null
          id?: string
          payload?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      instagram_subscriptions: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          instagram_handle: string
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          instagram_handle: string
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          instagram_handle?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_subscriptions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "instagram_subscriptions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      insuracloud_backfill_log: {
        Row: {
          agents_matched: number
          agents_unmatched: number
          carriers_matched: number
          carriers_unmatched: number
          details: Json | null
          id: string
          ran_at: string
          ran_by: string | null
        }
        Insert: {
          agents_matched?: number
          agents_unmatched?: number
          carriers_matched?: number
          carriers_unmatched?: number
          details?: Json | null
          id?: string
          ran_at?: string
          ran_by?: string | null
        }
        Update: {
          agents_matched?: number
          agents_unmatched?: number
          carriers_matched?: number
          carriers_unmatched?: number
          details?: Json | null
          id?: string
          ran_at?: string
          ran_by?: string | null
        }
        Relationships: []
      }
      insuracloud_downline: {
        Row: {
          agent_id: string | null
          downline_external_id: string | null
          downline_name: string
          id: string
          period_end: string | null
          period_start: string | null
          policy_count: number | null
          rank: number | null
          raw_payload: Json | null
          synced_at: string
          total_commission: number | null
        }
        Insert: {
          agent_id?: string | null
          downline_external_id?: string | null
          downline_name: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          policy_count?: number | null
          rank?: number | null
          raw_payload?: Json | null
          synced_at?: string
          total_commission?: number | null
        }
        Update: {
          agent_id?: string | null
          downline_external_id?: string | null
          downline_name?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          policy_count?: number | null
          rank?: number | null
          raw_payload?: Json | null
          synced_at?: string
          total_commission?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insuracloud_downline_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "insuracloud_downline_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      insuracloud_payouts: {
        Row: {
          agent_id: string | null
          amount: number
          id: string
          is_today: boolean | null
          payout_date: string
          policy_count: number | null
          raw_payload: Json | null
          synced_at: string
        }
        Insert: {
          agent_id?: string | null
          amount?: number
          id?: string
          is_today?: boolean | null
          payout_date: string
          policy_count?: number | null
          raw_payload?: Json | null
          synced_at?: string
        }
        Update: {
          agent_id?: string | null
          amount?: number
          id?: string
          is_today?: boolean | null
          payout_date?: string
          policy_count?: number | null
          raw_payload?: Json | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insuracloud_payouts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "insuracloud_payouts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      insuracloud_policies: {
        Row: {
          agent_id: string | null
          carrier: string | null
          commission: number | null
          commission_type: string | null
          downline_agent_name: string | null
          effective_date: string | null
          id: string
          issued_date: string | null
          policy_number: string | null
          policy_status: string | null
          policy_type: string | null
          premium: number | null
          product: string | null
          raw_payload: Json | null
          synced_at: string
        }
        Insert: {
          agent_id?: string | null
          carrier?: string | null
          commission?: number | null
          commission_type?: string | null
          downline_agent_name?: string | null
          effective_date?: string | null
          id?: string
          issued_date?: string | null
          policy_number?: string | null
          policy_status?: string | null
          policy_type?: string | null
          premium?: number | null
          product?: string | null
          raw_payload?: Json | null
          synced_at?: string
        }
        Update: {
          agent_id?: string | null
          carrier?: string | null
          commission?: number | null
          commission_type?: string | null
          downline_agent_name?: string | null
          effective_date?: string | null
          id?: string
          issued_date?: string | null
          policy_number?: string | null
          policy_status?: string | null
          policy_type?: string | null
          premium?: number | null
          product?: string | null
          raw_payload?: Json | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insuracloud_policies_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "insuracloud_policies_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      insuracloud_snapshots: {
        Row: {
          agent_id: string | null
          created_at: string
          direct_commissions: number | null
          forecast_90_day: number | null
          id: string
          mtd_earnings: number | null
          override_commissions: number | null
          raw_payload: Json | null
          snapshot_date: string
          snapshot_time: string
          source: string | null
          today_earnings: number | null
          ytd_earnings: number | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          direct_commissions?: number | null
          forecast_90_day?: number | null
          id?: string
          mtd_earnings?: number | null
          override_commissions?: number | null
          raw_payload?: Json | null
          snapshot_date?: string
          snapshot_time?: string
          source?: string | null
          today_earnings?: number | null
          ytd_earnings?: number | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          direct_commissions?: number | null
          forecast_90_day?: number | null
          id?: string
          mtd_earnings?: number | null
          override_commissions?: number | null
          raw_payload?: Json | null
          snapshot_date?: string
          snapshot_time?: string
          source?: string | null
          today_earnings?: number | null
          ytd_earnings?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insuracloud_snapshots_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "insuracloud_snapshots_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      insuracloud_sync_log: {
        Row: {
          agent_id: string | null
          created_at: string
          endpoints_hit: Json | null
          error_message: string | null
          id: string
          records_synced: Json | null
          status: string
          sync_completed_at: string | null
          sync_started_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          endpoints_hit?: Json | null
          error_message?: string | null
          id?: string
          records_synced?: Json | null
          status?: string
          sync_completed_at?: string | null
          sync_started_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          endpoints_hit?: Json | null
          error_message?: string | null
          id?: string
          records_synced?: Json | null
          status?: string
          sync_completed_at?: string | null
          sync_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insuracloud_sync_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "insuracloud_sync_log_agent_id_fkey"
            columns: ["agent_id"]
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
          summary: Json | null
          transcription: string | null
        }
        Insert: {
          agent_id?: string | null
          application_id: string
          created_at?: string | null
          duration_seconds?: number | null
          id?: string
          summary?: Json | null
          transcription?: string | null
        }
        Update: {
          agent_id?: string | null
          application_id?: string
          created_at?: string | null
          duration_seconds?: number | null
          id?: string
          summary?: Json | null
          transcription?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_recordings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
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
      invitation_seen: {
        Row: {
          agent_id: string
          id: string
          seen_at: string
          viewer_user_id: string
        }
        Insert: {
          agent_id: string
          id?: string
          seen_at?: string
          viewer_user_id: string
        }
        Update: {
          agent_id?: string
          id?: string
          seen_at?: string
          viewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_seen_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "invitation_seen_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activity: {
        Row: {
          activity_type: string
          actor_name: string | null
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          details: Json | null
          id: string
          lead_id: string
          title: string
        }
        Insert: {
          activity_type: string
          actor_name?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          lead_id: string
          title: string
        }
        Update: {
          activity_type?: string
          actor_name?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          lead_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activity_lead_id_fkey"
            columns: ["lead_id"]
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
      lead_payment_tracking: {
        Row: {
          agent_id: string
          id: string
          marked_at: string | null
          marked_by: string | null
          paid: boolean | null
          tier: string
          week_start: string
        }
        Insert: {
          agent_id: string
          id?: string
          marked_at?: string | null
          marked_by?: string | null
          paid?: boolean | null
          tier: string
          week_start?: string
        }
        Update: {
          agent_id?: string
          id?: string
          marked_at?: string | null
          marked_by?: string | null
          paid?: boolean | null
          tier?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_payment_tracking_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "lead_payment_tracking_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_purchase_requests: {
        Row: {
          agent_id: string
          amount_paid: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          id: string
          notes: string | null
          package_type: string
          payment_method: string | null
          requested_at: string | null
          status: string | null
          transaction_id: string | null
        }
        Insert: {
          agent_id: string
          amount_paid?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          id?: string
          notes?: string | null
          package_type: string
          payment_method?: string | null
          requested_at?: string | null
          status?: string | null
          transaction_id?: string | null
        }
        Update: {
          agent_id?: string
          amount_paid?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          id?: string
          notes?: string | null
          package_type?: string
          payment_method?: string | null
          requested_at?: string | null
          status?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_purchase_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "lead_purchase_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      licensing_delegates: {
        Row: {
          application_id: string
          assigned_at: string
          assigned_by: string | null
          created_at: string
          delegate_name: string | null
          delegate_user_id: string
          id: string
          is_active: boolean
          notes: string | null
          updated_at: string
        }
        Insert: {
          application_id: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          delegate_name?: string | null
          delegate_user_id: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Update: {
          application_id?: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          delegate_name?: string | null
          delegate_user_id?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "licensing_delegates_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      licensing_nudges: {
        Row: {
          application_id: string
          channel: string
          day_number: number
          id: string
          nudge_type: string
          sent_at: string
        }
        Insert: {
          application_id: string
          channel?: string
          day_number: number
          id?: string
          nudge_type: string
          sent_at?: string
        }
        Update: {
          application_id?: string
          channel?: string
          day_number?: number
          id?: string
          nudge_type?: string
          sent_at?: string
        }
        Relationships: []
      }
      magic_login_tokens: {
        Row: {
          agent_id: string
          created_at: string | null
          destination: string | null
          email: string
          expires_at: string | null
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          destination?: string | null
          email: string
          expires_at?: string | null
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          destination?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "magic_login_tokens_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "magic_login_tokens_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_growth_stats: {
        Row: {
          agent_id: string
          applications_submitted: number
          created_at: string
          follower_count: number
          followers_gained: number
          id: string
          instagram_views: number
          stat_date: string
        }
        Insert: {
          agent_id: string
          applications_submitted?: number
          created_at?: string
          follower_count?: number
          followers_gained?: number
          id?: string
          instagram_views?: number
          stat_date?: string
        }
        Update: {
          agent_id?: string
          applications_submitted?: number
          created_at?: string
          follower_count?: number
          followers_gained?: number
          id?: string
          instagram_views?: number
          stat_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_growth_stats_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "manager_growth_stats_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
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
      notification_log: {
        Row: {
          agent_id: string | null
          body: string | null
          channel: string
          created_at: string
          error_message: string | null
          id: string
          message: string
          metadata: Json | null
          notification_type: string | null
          opened_at: string | null
          recipient_email: string | null
          recipient_phone: string | null
          recipient_user_id: string | null
          status: string
          subject: string | null
          title: string
        }
        Insert: {
          agent_id?: string | null
          body?: string | null
          channel: string
          created_at?: string
          error_message?: string | null
          id?: string
          message: string
          metadata?: Json | null
          notification_type?: string | null
          opened_at?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          recipient_user_id?: string | null
          status?: string
          subject?: string | null
          title: string
        }
        Update: {
          agent_id?: string | null
          body?: string | null
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          notification_type?: string | null
          opened_at?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          recipient_user_id?: string | null
          status?: string
          subject?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "notification_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          id: string
          link: string | null
          metadata: Json | null
          priority: string | null
          read_at: string | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          id?: string
          link?: string | null
          metadata?: Json | null
          priority?: string | null
          read_at?: string | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          id?: string
          link?: string | null
          metadata?: Json | null
          priority?: string | null
          read_at?: string | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      onboarding_modules: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          order_index: number
          pass_threshold: number | null
          title: string
          video_url: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          order_index: number
          pass_threshold?: number | null
          title: string
          video_url: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          order_index?: number
          pass_threshold?: number | null
          title?: string
          video_url?: string
        }
        Relationships: []
      }
      onboarding_progress: {
        Row: {
          agent_id: string
          answers: Json | null
          attempts: number | null
          completed_at: string | null
          id: string
          module_id: string
          passed: boolean | null
          score: number | null
          started_at: string | null
          video_watched_percent: number | null
        }
        Insert: {
          agent_id: string
          answers?: Json | null
          attempts?: number | null
          completed_at?: string | null
          id?: string
          module_id: string
          passed?: boolean | null
          score?: number | null
          started_at?: string | null
          video_watched_percent?: number | null
        }
        Update: {
          agent_id?: string
          answers?: Json | null
          attempts?: number | null
          completed_at?: string | null
          id?: string
          module_id?: string
          passed?: boolean | null
          score?: number | null
          started_at?: string | null
          video_watched_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "onboarding_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_questions: {
        Row: {
          correct_answer: number
          created_at: string | null
          explanation: string | null
          id: string
          module_id: string
          options: Json
          order_index: number | null
          question: string
        }
        Insert: {
          correct_answer: number
          created_at?: string | null
          explanation?: string | null
          id?: string
          module_id: string
          options: Json
          order_index?: number | null
          question: string
        }
        Update: {
          correct_answer?: number
          created_at?: string | null
          explanation?: string | null
          id?: string
          module_id?: string
          options?: Json
          order_index?: number | null
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_questions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "onboarding_modules"
            referencedColumns: ["id"]
          },
        ]
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
      pipeline_metrics: {
        Row: {
          application_id: string
          created_at: string
          entered_at: string
          exited_at: string | null
          id: string
          stage: string
        }
        Insert: {
          application_id: string
          created_at?: string
          entered_at?: string
          exited_at?: string | null
          id?: string
          stage: string
        }
        Update: {
          application_id?: string
          created_at?: string
          entered_at?: string
          exited_at?: string | null
          id?: string
          stage?: string
        }
        Relationships: []
      }
      plaque_awards: {
        Row: {
          agent_id: string
          amount: number | null
          amount_at_time: number | null
          awarded_at: string | null
          badge_label: string | null
          color_hex: string | null
          created_at: string | null
          custom_photo_url: string | null
          email_delivery_status: string | null
          email_error: string | null
          email_sent_at: string | null
          generated_at: string | null
          id: string
          image_png_url: string | null
          image_svg_url: string | null
          milestone_date: string
          milestone_type: string
          share_slug: string | null
        }
        Insert: {
          agent_id: string
          amount?: number | null
          amount_at_time?: number | null
          awarded_at?: string | null
          badge_label?: string | null
          color_hex?: string | null
          created_at?: string | null
          custom_photo_url?: string | null
          email_delivery_status?: string | null
          email_error?: string | null
          email_sent_at?: string | null
          generated_at?: string | null
          id?: string
          image_png_url?: string | null
          image_svg_url?: string | null
          milestone_date: string
          milestone_type: string
          share_slug?: string | null
        }
        Update: {
          agent_id?: string
          amount?: number | null
          amount_at_time?: number | null
          awarded_at?: string | null
          badge_label?: string | null
          color_hex?: string | null
          created_at?: string | null
          custom_photo_url?: string | null
          email_delivery_status?: string | null
          email_error?: string | null
          email_sent_at?: string | null
          generated_at?: string | null
          id?: string
          image_png_url?: string | null
          image_svg_url?: string | null
          milestone_date?: string
          milestone_type?: string
          share_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plaque_awards_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "plaque_awards_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          carrier: string | null
          city: string | null
          created_at: string
          discord_webhook_url: string | null
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
          carrier?: string | null
          city?: string | null
          created_at?: string
          discord_webhook_url?: string | null
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
          carrier?: string | null
          city?: string | null
          created_at?: string
          discord_webhook_url?: string | null
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      qe_build_charts: {
        Row: {
          created_at: string
          gender: string
          height_inches: number
          id: string
          max_weight: number
          min_weight: number
          product_id: string
          rate_class: string
        }
        Insert: {
          created_at?: string
          gender?: string
          height_inches: number
          id?: string
          max_weight: number
          min_weight: number
          product_id: string
          rate_class?: string
        }
        Update: {
          created_at?: string
          gender?: string
          height_inches?: number
          id?: string
          max_weight?: number
          min_weight?: number
          product_id?: string
          rate_class?: string
        }
        Relationships: [
          {
            foreignKeyName: "qe_build_charts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_carriers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
        }
        Relationships: []
      }
      qe_commission_schedules: {
        Row: {
          advance_months: number | null
          created_at: string
          effective_date: string | null
          first_year_pct: number
          id: string
          product_id: string
          renewal_pct: number | null
          source_doc_id: string | null
        }
        Insert: {
          advance_months?: number | null
          created_at?: string
          effective_date?: string | null
          first_year_pct?: number
          id?: string
          product_id: string
          renewal_pct?: number | null
          source_doc_id?: string | null
        }
        Update: {
          advance_months?: number | null
          created_at?: string
          effective_date?: string | null
          first_year_pct?: number
          id?: string
          product_id?: string
          renewal_pct?: number | null
          source_doc_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qe_commission_schedules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qe_commission_schedules_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "qe_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_conditions: {
        Row: {
          category: Database["public"]["Enums"]["qe_condition_category"]
          created_at: string
          description: string | null
          id: string
          name: string
          synonyms: string[] | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["qe_condition_category"]
          created_at?: string
          description?: string | null
          id?: string
          name: string
          synonyms?: string[] | null
        }
        Update: {
          category?: Database["public"]["Enums"]["qe_condition_category"]
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          synonyms?: string[] | null
        }
        Relationships: []
      }
      qe_graded_routing_rules: {
        Row: {
          condition_key: string
          created_at: string
          description: string | null
          id: string
          product_id: string
          routes_to: Database["public"]["Enums"]["qe_benefit_type"]
        }
        Insert: {
          condition_key: string
          created_at?: string
          description?: string | null
          id?: string
          product_id: string
          routes_to?: Database["public"]["Enums"]["qe_benefit_type"]
        }
        Update: {
          condition_key?: string
          created_at?: string
          description?: string | null
          id?: string
          product_id?: string
          routes_to?: Database["public"]["Enums"]["qe_benefit_type"]
        }
        Relationships: [
          {
            foreignKeyName: "qe_graded_routing_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_medications: {
        Row: {
          brand_names: string[] | null
          category: Database["public"]["Enums"]["qe_condition_category"]
          created_at: string
          description: string | null
          generic_name: string | null
          id: string
          linked_conditions: string[] | null
          name: string
        }
        Insert: {
          brand_names?: string[] | null
          category?: Database["public"]["Enums"]["qe_condition_category"]
          created_at?: string
          description?: string | null
          generic_name?: string | null
          id?: string
          linked_conditions?: string[] | null
          name: string
        }
        Update: {
          brand_names?: string[] | null
          category?: Database["public"]["Enums"]["qe_condition_category"]
          created_at?: string
          description?: string | null
          generic_name?: string | null
          id?: string
          linked_conditions?: string[] | null
          name?: string
        }
        Relationships: []
      }
      qe_modal_factors: {
        Row: {
          factor: number
          id: string
          mode: string
          product_id: string
        }
        Insert: {
          factor?: number
          id?: string
          mode: string
          product_id: string
        }
        Update: {
          factor?: number
          id?: string
          mode?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qe_modal_factors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_payment_methods: {
        Row: {
          id: string
          is_supported: boolean
          method: string
          notes: string | null
          product_id: string
        }
        Insert: {
          id?: string
          is_supported?: boolean
          method: string
          notes?: string | null
          product_id: string
        }
        Update: {
          id?: string
          is_supported?: boolean
          method?: string
          notes?: string | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qe_payment_methods_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_product_badges: {
        Row: {
          badge_code: string
          id: string
          product_id: string
          source_doc_id: string | null
          tooltip_text: string | null
        }
        Insert: {
          badge_code: string
          id?: string
          product_id: string
          source_doc_id?: string | null
          tooltip_text?: string | null
        }
        Update: {
          badge_code?: string
          id?: string
          product_id?: string
          source_doc_id?: string | null
          tooltip_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qe_product_badges_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qe_product_badges_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "qe_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_product_states: {
        Row: {
          id: string
          is_available: boolean
          product_id: string
          state_code: string
        }
        Insert: {
          id?: string
          is_available?: boolean
          product_id: string
          state_code: string
        }
        Update: {
          id?: string
          is_available?: boolean
          product_id?: string
          state_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "qe_product_states_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_products: {
        Row: {
          carrier_id: string
          category: Database["public"]["Enums"]["qe_product_category"]
          created_at: string
          has_gi: boolean
          has_graded: boolean
          id: string
          is_active: boolean
          max_age: number
          max_face: number
          min_age: number
          min_face: number
          name: string
          needs_verification: boolean
          notes: string | null
        }
        Insert: {
          carrier_id: string
          category?: Database["public"]["Enums"]["qe_product_category"]
          created_at?: string
          has_gi?: boolean
          has_graded?: boolean
          id?: string
          is_active?: boolean
          max_age?: number
          max_face?: number
          min_age?: number
          min_face?: number
          name: string
          needs_verification?: boolean
          notes?: string | null
        }
        Update: {
          carrier_id?: string
          category?: Database["public"]["Enums"]["qe_product_category"]
          created_at?: string
          has_gi?: boolean
          has_graded?: boolean
          id?: string
          is_active?: boolean
          max_age?: number
          max_face?: number
          min_age?: number
          min_face?: number
          name?: string
          needs_verification?: boolean
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qe_products_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "qe_carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_quote_logs: {
        Row: {
          agent_user_id: string | null
          client_inputs: Json
          created_at: string
          id: string
          products_considered: Json | null
          products_excluded: Json | null
          ranking_output: Json | null
          rule_set_version: string | null
          source_versions: Json | null
        }
        Insert: {
          agent_user_id?: string | null
          client_inputs?: Json
          created_at?: string
          id?: string
          products_considered?: Json | null
          products_excluded?: Json | null
          ranking_output?: Json | null
          rule_set_version?: string | null
          source_versions?: Json | null
        }
        Update: {
          agent_user_id?: string | null
          client_inputs?: Json
          created_at?: string
          id?: string
          products_considered?: Json | null
          products_excluded?: Json | null
          ranking_output?: Json | null
          rule_set_version?: string | null
          source_versions?: Json | null
        }
        Relationships: []
      }
      qe_rate_tables: {
        Row: {
          age: number
          created_at: string
          effective_date: string | null
          face_amount: number
          gender: string
          id: string
          modal_factor_annual: number | null
          modal_factor_quarterly: number | null
          modal_factor_semi: number | null
          monthly_premium: number
          needs_verification: boolean
          product_id: string
          rate_class: string
          source_doc_id: string | null
          state_code: string | null
          tobacco_class: string
        }
        Insert: {
          age: number
          created_at?: string
          effective_date?: string | null
          face_amount: number
          gender?: string
          id?: string
          modal_factor_annual?: number | null
          modal_factor_quarterly?: number | null
          modal_factor_semi?: number | null
          monthly_premium: number
          needs_verification?: boolean
          product_id: string
          rate_class?: string
          source_doc_id?: string | null
          state_code?: string | null
          tobacco_class?: string
        }
        Update: {
          age?: number
          created_at?: string
          effective_date?: string | null
          face_amount?: number
          gender?: string
          id?: string
          modal_factor_annual?: number | null
          modal_factor_quarterly?: number | null
          modal_factor_semi?: number | null
          monthly_premium?: number
          needs_verification?: boolean
          product_id?: string
          rate_class?: string
          source_doc_id?: string | null
          state_code?: string | null
          tobacco_class?: string
        }
        Relationships: [
          {
            foreignKeyName: "qe_rate_tables_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qe_rate_tables_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "qe_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_scoring_weights: {
        Row: {
          approval_weight: number
          commission_weight: number
          created_at: string
          id: string
          is_default: boolean
          label: string
          persistency_weight: number
          placement_weight: number
          premium_weight: number
          suitability_weight: number
          updated_by: string | null
        }
        Insert: {
          approval_weight?: number
          commission_weight?: number
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          persistency_weight?: number
          placement_weight?: number
          premium_weight?: number
          suitability_weight?: number
          updated_by?: string | null
        }
        Update: {
          approval_weight?: number
          commission_weight?: number
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          persistency_weight?: number
          placement_weight?: number
          premium_weight?: number
          suitability_weight?: number
          updated_by?: string | null
        }
        Relationships: []
      }
      qe_source_documents: {
        Row: {
          carrier_id: string | null
          confidence_status: Database["public"]["Enums"]["qe_confidence_status"]
          doc_name: string
          doc_type: string
          effective_date: string | null
          id: string
          product_id: string | null
          source_url: string | null
          uploaded_at: string
          uploaded_by: string | null
          version: string | null
        }
        Insert: {
          carrier_id?: string | null
          confidence_status?: Database["public"]["Enums"]["qe_confidence_status"]
          doc_name: string
          doc_type?: string
          effective_date?: string | null
          id?: string
          product_id?: string | null
          source_url?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          version?: string | null
        }
        Update: {
          carrier_id?: string | null
          confidence_status?: Database["public"]["Enums"]["qe_confidence_status"]
          doc_name?: string
          doc_type?: string
          effective_date?: string | null
          id?: string
          product_id?: string | null
          source_url?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qe_source_documents_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "qe_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qe_source_documents_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
        ]
      }
      qe_underwriting_knockouts: {
        Row: {
          created_at: string
          description: string | null
          id: string
          lookback_months: number | null
          product_id: string
          routes_to: Database["public"]["Enums"]["qe_benefit_type"] | null
          rule_key: string
          rule_type: string
          rule_value: string | null
          severity: string
          source_doc_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          lookback_months?: number | null
          product_id: string
          routes_to?: Database["public"]["Enums"]["qe_benefit_type"] | null
          rule_key: string
          rule_type?: string
          rule_value?: string | null
          severity?: string
          source_doc_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          lookback_months?: number | null
          product_id?: string
          routes_to?: Database["public"]["Enums"]["qe_benefit_type"] | null
          rule_key?: string
          rule_type?: string
          rule_value?: string | null
          severity?: string
          source_doc_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qe_underwriting_knockouts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "qe_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qe_underwriting_knockouts_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "qe_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket_key: string
          created_at: string
          id: string
          request_count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          created_at?: string
          id?: string
          request_count?: number
          window_start: string
        }
        Update: {
          bucket_key?: string
          created_at?: string
          id?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      recurring_calendar_blocks: {
        Row: {
          category: string
          created_at: string
          day_of_week: number | null
          end_hour: number
          id: string
          is_active: boolean
          notes: string | null
          recurrence_type: string
          start_hour: number
          title: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          day_of_week?: number | null
          end_hour: number
          id?: string
          is_active?: boolean
          notes?: string | null
          recurrence_type?: string
          start_hour: number
          title: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          day_of_week?: number | null
          end_hour?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          recurrence_type?: string
          start_hour?: number
          title?: string
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
      scheduled_interviews: {
        Row: {
          application_id: string
          created_at: string
          id: string
          interview_date: string
          interview_type: string
          meeting_link: string | null
          notes: string | null
          scheduled_by: string
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          interview_date: string
          interview_type?: string
          meeting_link?: string | null
          notes?: string | null
          scheduled_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          interview_date?: string
          interview_type?: string
          meeting_link?: string | null
          notes?: string | null
          scheduled_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_tasks: {
        Row: {
          agent_id: string
          completed_at: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          scheduled_for: string
          status: string
          task_type: string
        }
        Insert: {
          agent_id: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          scheduled_for: string
          status?: string
          task_type: string
        }
        Update: {
          agent_id?: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          scheduled_for?: string
          status?: string
          task_type?: string
        }
        Relationships: []
      }
      seminar_registrations: {
        Row: {
          attended: boolean | null
          created_at: string
          email: string
          first_name: string
          follow_up_sent_at: string | null
          id: string
          last_name: string
          license_status: string | null
          notes: string | null
          phone: string | null
          registered_at: string
          seminar_date: string | null
          source: string | null
        }
        Insert: {
          attended?: boolean | null
          created_at?: string
          email: string
          first_name: string
          follow_up_sent_at?: string | null
          id?: string
          last_name: string
          license_status?: string | null
          notes?: string | null
          phone?: string | null
          registered_at?: string
          seminar_date?: string | null
          source?: string | null
        }
        Update: {
          attended?: boolean | null
          created_at?: string
          email?: string
          first_name?: string
          follow_up_sent_at?: string | null
          id?: string
          last_name?: string
          license_status?: string | null
          notes?: string | null
          phone?: string | null
          registered_at?: string
          seminar_date?: string | null
          source?: string | null
        }
        Relationships: []
      }
      sms_send_guard: {
        Row: {
          last_sent_at: string | null
          phone_e164: string
        }
        Insert: {
          last_sent_at?: string | null
          phone_e164: string
        }
        Update: {
          last_sent_at?: string | null
          phone_e164?: string
        }
        Relationships: []
      }
      system_health_logs: {
        Row: {
          auto_fixed: string[] | null
          checked_at: string | null
          created_at: string | null
          critical_count: number | null
          id: string
          overall_status: string | null
          results: Json | null
          warning_count: number | null
        }
        Insert: {
          auto_fixed?: string[] | null
          checked_at?: string | null
          created_at?: string | null
          critical_count?: number | null
          id?: string
          overall_status?: string | null
          results?: Json | null
          warning_count?: number | null
        }
        Update: {
          auto_fixed?: string[] | null
          checked_at?: string | null
          created_at?: string | null
          critical_count?: number | null
          id?: string
          overall_status?: string | null
          results?: Json | null
          warning_count?: number | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      team_chat_messages: {
        Row: {
          author_avatar: string | null
          author_name: string
          body: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          author_avatar?: string | null
          author_name: string
          body: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          author_avatar?: string | null
          author_name?: string
          body?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_dashboard_prefs: {
        Row: {
          created_at: string
          hidden_cards: string[]
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hidden_cards?: string[]
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hidden_cards?: string[]
          id?: string
          updated_at?: string
          user_id?: string
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
      agent_lifetime_production: {
        Row: {
          agent_id: string | null
          last_production_date: string | null
          lifetime_alp: number | null
          lifetime_deals: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_production_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_revenue_estimate"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "daily_production_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_revenue_estimate: {
        Row: {
          agent_id: string | null
          contract_pct: number | null
          downline_monthly_alp: number | null
          insuracloud_direct: number | null
          insuracloud_last_sync: string | null
          insuracloud_mtd: number | null
          insuracloud_override: number | null
          override_monthly_estimate: number | null
          override_rate: number | null
          personal_monthly_alp: number | null
          personal_monthly_estimate: number | null
        }
        Relationships: []
      }
      automation_health: {
        Row: {
          avg_duration_ms: number | null
          error_count_24h: number | null
          health_status: string | null
          job_name: string | null
          last_error: string | null
          last_run: string | null
          success_count_24h: number | null
          total_24h: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_configure_integration: {
        Args: { p_key: string; p_value: string }
        Returns: Json
      }
      agentlink_live_pull: {
        Args: never
        Returns: {
          deals_inserted: number | null
          deals_updated: number | null
          error_message: string | null
          finished_at: string | null
          http_request_id: number | null
          id: string
          policies_seen: number | null
          started_at: string
          status: string
          upstream_status: number | null
        }
        SetofOptions: {
          from: "*"
          to: "agentlink_sync_log"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apex_render_plaque: {
        Args: {
          p_amount: number
          p_date: string
          p_name: string
          p_photo_url?: string
          p_tier: string
        }
        Returns: string
      }
      apex_self_heal: { Args: never; Returns: Json }
      applicant_contacted_recently: {
        Args: { p_app_id: string; p_hours?: number }
        Returns: boolean
      }
      bot_audit_hot_conversations: { Args: never; Returns: number }
      bot_audit_licensing: { Args: never; Returns: Json }
      bot_discover_awards: { Args: never; Returns: Json }
      check_banned_prospect: {
        Args: {
          p_email?: string
          p_first_name?: string
          p_last_name?: string
          p_phone?: string
        }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          _bucket_key: string
          _max_requests: number
          _window_seconds: number
        }
        Returns: boolean
      }
      cleanup_expired_idempotency_keys: { Args: never; Returns: undefined }
      current_agent_id: { Args: never; Returns: string }
      current_manager_agent_id: { Args: never; Returns: string }
      ensure_next_month_partitions: { Args: never; Returns: undefined }
      get_agent_id: { Args: { _user_id: string }; Returns: string }
      get_agent_production_stats: {
        Args: { end_date: string; start_date: string }
        Returns: {
          agent_id: string
          last_activity_date: string
          total_alp: number
          total_deals: number
          total_presentations: number
        }[]
      }
      get_cron_jobs_with_status: {
        Args: never
        Returns: {
          active: boolean
          command: string
          errors_24h: number
          jobname: string
          last_error: string
          last_run: string
          last_status: string
          runs_24h: number
          schedule: string
        }[]
      }
      get_daily_leaderboard: {
        Args: { p_date: string }
        Returns: {
          aop: number
          full_name: string
          instagram_handle: string
        }[]
      }
      get_downline_agent_ids: {
        Args: { p_root_agent_id: string }
        Returns: {
          agent_id: string
        }[]
      }
      get_leaderboard_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          full_name: string
          user_id: string
        }[]
      }
      get_or_create_ics_token: { Args: never; Returns: string }
      get_weekly_leaderboard: {
        Args: { p_end: string; p_start: string }
        Returns: {
          full_name: string
          instagram_handle: string
          weekly_aop: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ig_bucket: {
        Args: { last_msg_at: string; last_sender: string }
        Returns: string
      }
      is_first_monday_of_month: { Args: never; Returns: boolean }
      licensing_stage_nudge_sweep: { Args: never; Returns: Json }
      my_downline_agent_ids: {
        Args: never
        Returns: {
          agent_id: string
        }[]
      }
      resolve_hiring_manager_for_scope: {
        Args: { p_scope: Database["public"]["Enums"]["hiring_scope"] }
        Returns: string
      }
      run_automation_job: {
        Args: { p_body?: Json; p_function_name: string; p_job_name: string }
        Returns: string
      }
      sms_allowed: {
        Args: { p_phone: string; p_window_minutes?: number }
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
        | "no_pickup"
      attendance_mark: "present" | "absent" | "excused" | "unmarked"
      attendance_status: "good" | "warning" | "critical"
      attendance_type:
        | "training"
        | "onboarded_meeting"
        | "dialer_activity"
        | "daily_sale"
        | "agency_meeting"
      deactivation_reason: "bad_business" | "inactive" | "switched_teams"
      hiring_scope:
        | "unlicensed"
        | "licensed"
        | "transfer"
        | "post_started"
        | "all"
      license_progress:
        | "unlicensed"
        | "course_purchased"
        | "finished_course"
        | "test_scheduled"
        | "passed_test"
        | "fingerprints_done"
        | "waiting_on_license"
        | "licensed"
        | "waiting_fingerprints"
      license_status: "licensed" | "unlicensed" | "pending"
      onboarding_stage:
        | "onboarding"
        | "training_online"
        | "in_field_training"
        | "evaluated"
        | "applied"
        | "meeting_attendance"
        | "pre_licensed"
        | "transfer"
        | "below_10k"
        | "live"
        | "need_followup"
        | "inactive"
        | "pending_review"
      performance_tier: "below_10k" | "standard" | "top_producer"
      qe_benefit_type: "immediate" | "graded" | "modified" | "guaranteed_issue"
      qe_condition_category:
        | "cardiac"
        | "respiratory"
        | "cancer"
        | "neurological"
        | "psychiatric"
        | "renal"
        | "liver"
        | "mobility_adl"
        | "autoimmune"
        | "metabolic"
        | "other"
      qe_confidence_status: "verified" | "unverified" | "stale"
      qe_product_category:
        | "final_expense"
        | "si_whole_life"
        | "si_ul"
        | "mortgage_protection"
        | "other"
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
        "no_pickup",
      ],
      attendance_mark: ["present", "absent", "excused", "unmarked"],
      attendance_status: ["good", "warning", "critical"],
      attendance_type: [
        "training",
        "onboarded_meeting",
        "dialer_activity",
        "daily_sale",
        "agency_meeting",
      ],
      deactivation_reason: ["bad_business", "inactive", "switched_teams"],
      hiring_scope: [
        "unlicensed",
        "licensed",
        "transfer",
        "post_started",
        "all",
      ],
      license_progress: [
        "unlicensed",
        "course_purchased",
        "finished_course",
        "test_scheduled",
        "passed_test",
        "fingerprints_done",
        "waiting_on_license",
        "licensed",
        "waiting_fingerprints",
      ],
      license_status: ["licensed", "unlicensed", "pending"],
      onboarding_stage: [
        "onboarding",
        "training_online",
        "in_field_training",
        "evaluated",
        "applied",
        "meeting_attendance",
        "pre_licensed",
        "transfer",
        "below_10k",
        "live",
        "need_followup",
        "inactive",
        "pending_review",
      ],
      performance_tier: ["below_10k", "standard", "top_producer"],
      qe_benefit_type: ["immediate", "graded", "modified", "guaranteed_issue"],
      qe_condition_category: [
        "cardiac",
        "respiratory",
        "cancer",
        "neurological",
        "psychiatric",
        "renal",
        "liver",
        "mobility_adl",
        "autoimmune",
        "metabolic",
        "other",
      ],
      qe_confidence_status: ["verified", "unverified", "stale"],
      qe_product_category: [
        "final_expense",
        "si_whole_life",
        "si_ul",
        "mortgage_protection",
        "other",
      ],
    },
  },
} as const
