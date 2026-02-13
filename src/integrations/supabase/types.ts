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
            referencedRelation: "agents"
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
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          agent_code: string | null
          attendance_status:
            | Database["public"]["Enums"]["attendance_status"]
            | null
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
          has_training_course: boolean | null
          id: string
          invited_by_manager_id: string | null
          is_deactivated: boolean | null
          is_inactive: boolean | null
          license_states: string[] | null
          license_status: Database["public"]["Enums"]["license_status"]
          manager_id: string | null
          nipr_number: string | null
          onboarding_completed_at: string | null
          onboarding_stage:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          password_required: boolean | null
          performance_tier:
            | Database["public"]["Enums"]["performance_tier"]
            | null
          portal_password_set: boolean | null
          potential_rating: number | null
          profile_id: string | null
          sort_order: number | null
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
          has_training_course?: boolean | null
          id?: string
          invited_by_manager_id?: string | null
          is_deactivated?: boolean | null
          is_inactive?: boolean | null
          license_states?: string[] | null
          license_status?: Database["public"]["Enums"]["license_status"]
          manager_id?: string | null
          nipr_number?: string | null
          onboarding_completed_at?: string | null
          onboarding_stage?:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          password_required?: boolean | null
          performance_tier?:
            | Database["public"]["Enums"]["performance_tier"]
            | null
          portal_password_set?: boolean | null
          potential_rating?: number | null
          profile_id?: string | null
          sort_order?: number | null
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
          has_training_course?: boolean | null
          id?: string
          invited_by_manager_id?: string | null
          is_deactivated?: boolean | null
          is_inactive?: boolean | null
          license_states?: string[] | null
          license_status?: Database["public"]["Enums"]["license_status"]
          manager_id?: string | null
          nipr_number?: string | null
          onboarding_completed_at?: string | null
          onboarding_stage?:
            | Database["public"]["Enums"]["onboarding_stage"]
            | null
          password_required?: boolean | null
          performance_tier?:
            | Database["public"]["Enums"]["performance_tier"]
            | null
          portal_password_set?: boolean | null
          potential_rating?: number | null
          profile_id?: string | null
          sort_order?: number | null
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
          {
            foreignKeyName: "agents_switched_to_manager_id_fkey"
            columns: ["switched_to_manager_id"]
            isOneToOne: false
            referencedRelation: "agents"
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
          consent_form_version: string | null
          consent_ip_address: string | null
          consent_source_url: string | null
          consent_timestamp_utc: string | null
          consent_user_agent: string | null
          contacted_at: string | null
          contracted_at: string | null
          created_at: string
          desired_income: number | null
          email: string
          email_consent_given: boolean | null
          email_consent_text: string | null
          first_name: string
          followup_licensed_sent_at: string | null
          followup_sent_at: string | null
          followup_unlicensed_2_sent_at: string | null
          has_insurance_experience: boolean | null
          id: string
          instagram_handle: string | null
          last_contacted_at: string | null
          last_name: string
          license_doc_url: string | null
          license_progress:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status: Database["public"]["Enums"]["license_status"]
          licensed_states: string[] | null
          manual_followup_sent_at: string | null
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
          years_experience: number | null
        }
        Insert: {
          assigned_agent_id?: string | null
          availability?: string | null
          city?: string | null
          closed_at?: string | null
          consent_form_version?: string | null
          consent_ip_address?: string | null
          consent_source_url?: string | null
          consent_timestamp_utc?: string | null
          consent_user_agent?: string | null
          contacted_at?: string | null
          contracted_at?: string | null
          created_at?: string
          desired_income?: number | null
          email: string
          email_consent_given?: boolean | null
          email_consent_text?: string | null
          first_name: string
          followup_licensed_sent_at?: string | null
          followup_sent_at?: string | null
          followup_unlicensed_2_sent_at?: string | null
          has_insurance_experience?: boolean | null
          id?: string
          instagram_handle?: string | null
          last_contacted_at?: string | null
          last_name: string
          license_doc_url?: string | null
          license_progress?:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status?: Database["public"]["Enums"]["license_status"]
          licensed_states?: string[] | null
          manual_followup_sent_at?: string | null
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
          years_experience?: number | null
        }
        Update: {
          assigned_agent_id?: string | null
          availability?: string | null
          city?: string | null
          closed_at?: string | null
          consent_form_version?: string | null
          consent_ip_address?: string | null
          consent_source_url?: string | null
          consent_timestamp_utc?: string | null
          consent_user_agent?: string | null
          contacted_at?: string | null
          contracted_at?: string | null
          created_at?: string
          desired_income?: number | null
          email?: string
          email_consent_given?: boolean | null
          email_consent_text?: string | null
          first_name?: string
          followup_licensed_sent_at?: string | null
          followup_sent_at?: string | null
          followup_unlicensed_2_sent_at?: string | null
          has_insurance_experience?: boolean | null
          id?: string
          instagram_handle?: string | null
          last_contacted_at?: string | null
          last_name?: string
          license_doc_url?: string | null
          license_progress?:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status?: Database["public"]["Enums"]["license_status"]
          licensed_states?: string[] | null
          manual_followup_sent_at?: string | null
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
            referencedRelation: "agents"
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
            referencedRelation: "agents"
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
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
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
      plaque_awards: {
        Row: {
          agent_id: string
          amount: number | null
          awarded_at: string | null
          id: string
          milestone_date: string
          milestone_type: string
        }
        Insert: {
          agent_id: string
          amount?: number | null
          awarded_at?: string | null
          id?: string
          milestone_date: string
          milestone_type: string
        }
        Update: {
          agent_id?: string
          amount?: number | null
          awarded_at?: string | null
          id?: string
          milestone_date?: string
          milestone_type?: string
        }
        Relationships: [
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
      check_banned_prospect: {
        Args: {
          p_email?: string
          p_first_name?: string
          p_last_name?: string
          p_phone?: string
        }
        Returns: boolean
      }
      current_agent_id: { Args: never; Returns: string }
      current_manager_agent_id: { Args: never; Returns: string }
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
      get_leaderboard_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          full_name: string
          user_id: string
        }[]
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
      deactivation_reason: "bad_business" | "inactive" | "switched_teams"
      license_progress:
        | "unlicensed"
        | "course_purchased"
        | "finished_course"
        | "test_scheduled"
        | "passed_test"
        | "fingerprints_done"
        | "waiting_on_license"
        | "licensed"
      license_status: "licensed" | "unlicensed" | "pending"
      onboarding_stage:
        | "onboarding"
        | "training_online"
        | "in_field_training"
        | "evaluated"
      performance_tier: "below_10k" | "standard" | "top_producer"
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
      ],
      deactivation_reason: ["bad_business", "inactive", "switched_teams"],
      license_progress: [
        "unlicensed",
        "course_purchased",
        "finished_course",
        "test_scheduled",
        "passed_test",
        "fingerprints_done",
        "waiting_on_license",
        "licensed",
      ],
      license_status: ["licensed", "unlicensed", "pending"],
      onboarding_stage: [
        "onboarding",
        "training_online",
        "in_field_training",
        "evaluated",
      ],
      performance_tier: ["below_10k", "standard", "top_producer"],
    },
  },
} as const
