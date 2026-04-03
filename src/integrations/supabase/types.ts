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
          lead_score: number | null
          license_doc_url: string | null
          license_progress:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status: Database["public"]["Enums"]["license_status"]
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
          lead_score?: number | null
          license_doc_url?: string | null
          license_progress?:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status?: Database["public"]["Enums"]["license_status"]
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
          lead_score?: number | null
          license_doc_url?: string | null
          license_progress?:
            | Database["public"]["Enums"]["license_progress"]
            | null
          license_status?: Database["public"]["Enums"]["license_status"]
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
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
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
          carrier: string | null
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
          carrier?: string | null
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
          carrier?: string | null
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
        | "agency_meeting"
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
        | "waiting_fingerprints"
      license_status: "licensed" | "unlicensed" | "pending"
      onboarding_stage:
        | "onboarding"
        | "training_online"
        | "in_field_training"
        | "evaluated"
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
