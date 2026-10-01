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
      ad_statements: {
        Row: {
          ad_id: string
          analysis_version: string | null
          confidence: number | null
          created_at: string
          description: string
          evidence: string
          id: string
          kind: string
          normalized_key: string
          normalizer_version: number
          owner_id: string
          raw_text: string
          source: string
          statement_id: string | null
          test_run_id: string | null
          updated_at: string
        }
        Insert: {
          ad_id: string
          analysis_version?: string | null
          confidence?: number | null
          created_at?: string
          description?: string
          evidence?: string
          id?: string
          kind: string
          normalized_key: string
          normalizer_version?: number
          owner_id: string
          raw_text: string
          source: string
          statement_id?: string | null
          test_run_id?: string | null
          updated_at?: string
        }
        Update: {
          ad_id?: string
          analysis_version?: string | null
          confidence?: number | null
          created_at?: string
          description?: string
          evidence?: string
          id?: string
          kind?: string
          normalized_key?: string
          normalizer_version?: number
          owner_id?: string
          raw_text?: string
          source?: string
          statement_id?: string | null
          test_run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_statements_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_statements_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads_with_duration"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_statements_statement_fk"
            columns: ["statement_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "pb_statements"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "ad_statements_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "pb_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          analysis: Json | null
          competitor_id: string
          created_at: string
          creation_date: string
          end_date: string | null
          id: string
          image_url: string | null
          is_demo: boolean
          last_seen_at: string | null
          owner_id: string | null
          pb_processed_at: string | null
          pb_result: Json | null
          pb_status: string | null
          product_description: string | null
          product_id: string | null
          product_name: string
          raw_ad_id: string | null
          source_ad_id: string | null
          source_page_id: string | null
          source_platform: string | null
          source_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          analysis?: Json | null
          competitor_id: string
          created_at?: string
          creation_date: string
          end_date?: string | null
          id?: string
          image_url?: string | null
          is_demo?: boolean
          last_seen_at?: string | null
          owner_id?: string | null
          pb_processed_at?: string | null
          pb_result?: Json | null
          pb_status?: string | null
          product_description?: string | null
          product_id?: string | null
          product_name: string
          raw_ad_id?: string | null
          source_ad_id?: string | null
          source_page_id?: string | null
          source_platform?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          analysis?: Json | null
          competitor_id?: string
          created_at?: string
          creation_date?: string
          end_date?: string | null
          id?: string
          image_url?: string | null
          is_demo?: boolean
          last_seen_at?: string | null
          owner_id?: string | null
          pb_processed_at?: string | null
          pb_result?: Json | null
          pb_status?: string | null
          product_description?: string | null
          product_id?: string | null
          product_name?: string
          raw_ad_id?: string | null
          source_ad_id?: string | null
          source_page_id?: string | null
          source_platform?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_raw_ad_id_fkey"
            columns: ["raw_ad_id"]
            isOneToOne: false
            referencedRelation: "competitor_raw_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_balance_holds: {
        Row: {
          amount_egp: number
          closed_at: string | null
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          status: string
        }
        Insert: {
          amount_egp: number
          closed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          owner_id: string
          status?: string
        }
        Update: {
          amount_egp?: number
          closed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          status?: string
        }
        Relationships: []
      }
      ai_model_prices: {
        Row: {
          cost_input_usd_per_million: number
          cost_output_usd_per_million: number
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          margin_percent: number
          model_id: string
          sell_input_egp_per_million: number
          sell_output_egp_per_million: number
          source: string
          usd_to_egp: number
        }
        Insert: {
          cost_input_usd_per_million?: number
          cost_output_usd_per_million?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          margin_percent?: number
          model_id: string
          sell_input_egp_per_million?: number
          sell_output_egp_per_million?: number
          source?: string
          usd_to_egp?: number
        }
        Update: {
          cost_input_usd_per_million?: number
          cost_output_usd_per_million?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          margin_percent?: number
          model_id?: string
          sell_input_egp_per_million?: number
          sell_output_egp_per_million?: number
          source?: string
          usd_to_egp?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_model_prices_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_models: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          is_default: boolean
          model_code: string
          provider_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          model_code: string
          provider_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          model_code?: string
          provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_pricing_settings: {
        Row: {
          created_at: string
          id: boolean
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          margin_percent: number
          min_deposit_egp: number
          openai_credit_since: string | null
          openai_credit_usd: number
          updated_at: string
          usd_to_egp: number
        }
        Insert: {
          created_at?: string
          id?: boolean
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          margin_percent?: number
          min_deposit_egp?: number
          openai_credit_since?: string | null
          openai_credit_usd?: number
          updated_at?: string
          usd_to_egp?: number
        }
        Update: {
          created_at?: string
          id?: boolean
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          margin_percent?: number
          min_deposit_egp?: number
          openai_credit_since?: string | null
          openai_credit_usd?: number
          updated_at?: string
          usd_to_egp?: number
        }
        Relationships: []
      }
      ai_provider_sync_runs: {
        Row: {
          cost_input_usd_per_million: number | null
          cost_output_usd_per_million: number | null
          created_at: string
          id: string
          input_cost_usd: number | null
          input_tokens: number | null
          message: string | null
          models_updated: number
          other_cost_usd: number | null
          output_cost_usd: number | null
          output_tokens: number | null
          period_end: string | null
          period_start: string | null
          price_id: string | null
          provider_code: string
          provider_cost_usd: number | null
          status: string
        }
        Insert: {
          cost_input_usd_per_million?: number | null
          cost_output_usd_per_million?: number | null
          created_at?: string
          id?: string
          input_cost_usd?: number | null
          input_tokens?: number | null
          message?: string | null
          models_updated?: number
          other_cost_usd?: number | null
          output_cost_usd?: number | null
          output_tokens?: number | null
          period_end?: string | null
          period_start?: string | null
          price_id?: string | null
          provider_code: string
          provider_cost_usd?: number | null
          status: string
        }
        Update: {
          cost_input_usd_per_million?: number | null
          cost_output_usd_per_million?: number | null
          created_at?: string
          id?: string
          input_cost_usd?: number | null
          input_tokens?: number | null
          message?: string | null
          models_updated?: number
          other_cost_usd?: number | null
          output_cost_usd?: number | null
          output_tokens?: number | null
          period_end?: string | null
          period_start?: string | null
          price_id?: string | null
          provider_code?: string
          provider_cost_usd?: number | null
          status?: string
        }
        Relationships: []
      }
      ai_providers: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          supports_cost_api: boolean
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          supports_cost_api?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          supports_cost_api?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage_events: {
        Row: {
          balance_after_egp: number | null
          charged_egp: number | null
          created_at: string
          id: string
          input_tokens: number
          model: string
          model_price_id: string | null
          operation: string
          output_tokens: number
          owner_id: string
          provider_code: string | null
          provider_cost_usd: number | null
          remaining_after: number | null
          sell_input_egp_per_million: number | null
          sell_output_egp_per_million: number | null
          source: string
          status: string
          total_tokens: number
        }
        Insert: {
          balance_after_egp?: number | null
          charged_egp?: number | null
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string
          model_price_id?: string | null
          operation?: string
          output_tokens?: number
          owner_id: string
          provider_code?: string | null
          provider_cost_usd?: number | null
          remaining_after?: number | null
          sell_input_egp_per_million?: number | null
          sell_output_egp_per_million?: number | null
          source: string
          status?: string
          total_tokens?: number
        }
        Update: {
          balance_after_egp?: number | null
          charged_egp?: number | null
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string
          model_price_id?: string | null
          operation?: string
          output_tokens?: number
          owner_id?: string
          provider_code?: string | null
          provider_cost_usd?: number | null
          remaining_after?: number | null
          sell_input_egp_per_million?: number | null
          sell_output_egp_per_million?: number | null
          source?: string
          status?: string
          total_tokens?: number
        }
        Relationships: []
      }
      bank_jobs: {
        Row: {
          added_ids: string[]
          categories_added: number
          control: string
          created_at: string
          deadline_at: string
          error: string | null
          finished_at: string | null
          id: string
          lease_expires_at: string | null
          note: string | null
          owner_id: string
          phase: string
          started_at: string
          status: string
          terms_added: number
          updated_at: string
        }
        Insert: {
          added_ids?: string[]
          categories_added?: number
          control?: string
          created_at?: string
          deadline_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          lease_expires_at?: string | null
          note?: string | null
          owner_id: string
          phase?: string
          started_at?: string
          status?: string
          terms_added?: number
          updated_at?: string
        }
        Update: {
          added_ids?: string[]
          categories_added?: number
          control?: string
          created_at?: string
          deadline_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          lease_expires_at?: string | null
          note?: string | null
          owner_id?: string
          phase?: string
          started_at?: string
          status?: string
          terms_added?: number
          updated_at?: string
        }
        Relationships: []
      }
      ccrawl_keys: {
        Row: {
          created_at: string
          found: number
          id: string
          key_text: string
          owner_id: string
          run_id: string
          searched_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          found?: number
          id?: string
          key_text: string
          owner_id: string
          run_id: string
          searched_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          found?: number
          id?: string
          key_text?: string
          owner_id?: string
          run_id?: string
          searched_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ccrawl_keys_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ccrawl_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ccrawl_pages: {
        Row: {
          ad_ids: string[]
          ads_sample: string[]
          analyzed_at: string | null
          created_at: string
          decision: string | null
          differences: string[]
          error: string | null
          id: string
          image_url: string | null
          matched_categories: string[]
          owner_id: string
          page_id: string
          page_name: string
          page_url: string
          reasons: string[]
          run_id: string | null
          score: number
          search_key: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ad_ids?: string[]
          ads_sample?: string[]
          analyzed_at?: string | null
          created_at?: string
          decision?: string | null
          differences?: string[]
          error?: string | null
          id?: string
          image_url?: string | null
          matched_categories?: string[]
          owner_id: string
          page_id: string
          page_name?: string
          page_url?: string
          reasons?: string[]
          run_id?: string | null
          score?: number
          search_key?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ad_ids?: string[]
          ads_sample?: string[]
          analyzed_at?: string | null
          created_at?: string
          decision?: string | null
          differences?: string[]
          error?: string | null
          id?: string
          image_url?: string | null
          matched_categories?: string[]
          owner_id?: string
          page_id?: string
          page_name?: string
          page_url?: string
          reasons?: string[]
          run_id?: string | null
          score?: number
          search_key?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ccrawl_runs: {
        Row: {
          categories: string[]
          category_ids: string[]
          control: string
          created_at: string
          deadline_at: string | null
          error: string | null
          finished_at: string | null
          id: string
          keys_done: number
          keys_total: number
          lease_expires_at: string | null
          matches: number
          note: string | null
          owner_id: string
          pages_analyzed: number
          pages_found: number
          scope: string
          started_at: string
          status: string
          trigger_type: string
          updated_at: string
        }
        Insert: {
          categories?: string[]
          category_ids?: string[]
          control?: string
          created_at?: string
          deadline_at?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          keys_done?: number
          keys_total?: number
          lease_expires_at?: string | null
          matches?: number
          note?: string | null
          owner_id: string
          pages_analyzed?: number
          pages_found?: number
          scope?: string
          started_at?: string
          status?: string
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          categories?: string[]
          category_ids?: string[]
          control?: string
          created_at?: string
          deadline_at?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          keys_done?: number
          keys_total?: number
          lease_expires_at?: string | null
          matches?: number
          note?: string | null
          owner_id?: string
          pages_analyzed?: number
          pages_found?: number
          scope?: string
          started_at?: string
          status?: string
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      competitor_collection_coverage: {
        Row: {
          ads_duplicate: number
          ads_found: number
          ads_new: number
          batches_max: number
          competitor_id: string
          first_batch_at: string | null
          jobs_done: number
          jobs_failed: number
          jobs_open: number
          jobs_total: number
          last_batch_at: string | null
          last_error: string | null
          owner_id: string
          paths_exhausted: number
          paths_total: number
          run_id: string
          status: string
          updated_at: string
        }
        Insert: {
          ads_duplicate?: number
          ads_found?: number
          ads_new?: number
          batches_max?: number
          competitor_id: string
          first_batch_at?: string | null
          jobs_done?: number
          jobs_failed?: number
          jobs_open?: number
          jobs_total?: number
          last_batch_at?: string | null
          last_error?: string | null
          owner_id: string
          paths_exhausted?: number
          paths_total?: number
          run_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          ads_duplicate?: number
          ads_found?: number
          ads_new?: number
          batches_max?: number
          competitor_id?: string
          first_batch_at?: string | null
          jobs_done?: number
          jobs_failed?: number
          jobs_open?: number
          jobs_total?: number
          last_batch_at?: string | null
          last_error?: string | null
          owner_id?: string
          paths_exhausted?: number
          paths_total?: number
          run_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_collection_coverage_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_collection_coverage_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "competitor_collection_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_collection_jobs: {
        Row: {
          ads_changed: number
          ads_duplicate: number
          ads_found: number
          ads_new: number
          attempts: number
          batch: number
          competitor_id: string
          created_at: string
          cursor: string | null
          debug: Json | null
          error: string | null
          error_type: string | null
          finished_at: string | null
          has_more: boolean
          heartbeat_at: string | null
          id: string
          lease_expires_at: string | null
          max_attempts: number
          next_attempt_at: string
          owner_id: string
          path: string
          run_id: string
          started_at: string | null
          status: string
          updated_at: string
          url: string
        }
        Insert: {
          ads_changed?: number
          ads_duplicate?: number
          ads_found?: number
          ads_new?: number
          attempts?: number
          batch?: number
          competitor_id: string
          created_at?: string
          cursor?: string | null
          debug?: Json | null
          error?: string | null
          error_type?: string | null
          finished_at?: string | null
          has_more?: boolean
          heartbeat_at?: string | null
          id?: string
          lease_expires_at?: string | null
          max_attempts?: number
          next_attempt_at?: string
          owner_id: string
          path: string
          run_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
          url: string
        }
        Update: {
          ads_changed?: number
          ads_duplicate?: number
          ads_found?: number
          ads_new?: number
          attempts?: number
          batch?: number
          competitor_id?: string
          created_at?: string
          cursor?: string | null
          debug?: Json | null
          error?: string | null
          error_type?: string | null
          finished_at?: string | null
          has_more?: boolean
          heartbeat_at?: string | null
          id?: string
          lease_expires_at?: string | null
          max_attempts?: number
          next_attempt_at?: string
          owner_id?: string
          path?: string
          run_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_collection_jobs_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_collection_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "competitor_collection_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_collection_runs: {
        Row: {
          ads_changed: number
          ads_duplicate: number
          ads_found: number
          ads_new: number
          ads_not_seen: number
          competitors_total: number
          control: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          jobs_done: number
          jobs_failed: number
          jobs_total: number
          owner_id: string
          run_number: number
          started_at: string
          status: string
          trigger_type: string
          updated_at: string
          wake_base: string | null
        }
        Insert: {
          ads_changed?: number
          ads_duplicate?: number
          ads_found?: number
          ads_new?: number
          ads_not_seen?: number
          competitors_total?: number
          control?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          jobs_done?: number
          jobs_failed?: number
          jobs_total?: number
          owner_id: string
          run_number?: number
          started_at?: string
          status?: string
          trigger_type?: string
          updated_at?: string
          wake_base?: string | null
        }
        Update: {
          ads_changed?: number
          ads_duplicate?: number
          ads_found?: number
          ads_new?: number
          ads_not_seen?: number
          competitors_total?: number
          control?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          jobs_done?: number
          jobs_failed?: number
          jobs_total?: number
          owner_id?: string
          run_number?: number
          started_at?: string
          status?: string
          trigger_type?: string
          updated_at?: string
          wake_base?: string | null
        }
        Relationships: []
      }
      competitor_domains: {
        Row: {
          created_at: string
          criteria: string[]
          description: string
          description_updated_at: string | null
          id: string
          keywords: string[]
          keywords_updated_at: string | null
          name: string
          name_key: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criteria?: string[]
          description?: string
          description_updated_at?: string | null
          id?: string
          keywords?: string[]
          keywords_updated_at?: string | null
          name: string
          name_key: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criteria?: string[]
          description?: string
          description_updated_at?: string | null
          id?: string
          keywords?: string[]
          keywords_updated_at?: string | null
          name?: string
          name_key?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      competitor_raw_ads: {
        Row: {
          ad_text: string
          changed_at: string | null
          competitor_id: string | null
          content_hash: string | null
          created_at: string
          discovered_at: string | null
          discovery_domain_id: string | null
          discovery_keys: string[]
          discovery_run_id: string | null
          end_date: string | null
          first_run_id: string | null
          first_seen_at: string
          id: string
          image_url: string | null
          is_active: boolean
          is_new: boolean
          last_checked_at: string | null
          last_run_id: string | null
          last_seen_at: string
          owner_id: string
          page_name: string
          seen_state: string
          source_ad_id: string
          source_page_id: string | null
          source_path: string | null
          source_url: string | null
          start_date: string | null
          updated_at: string
        }
        Insert: {
          ad_text?: string
          changed_at?: string | null
          competitor_id?: string | null
          content_hash?: string | null
          created_at?: string
          discovered_at?: string | null
          discovery_domain_id?: string | null
          discovery_keys?: string[]
          discovery_run_id?: string | null
          end_date?: string | null
          first_run_id?: string | null
          first_seen_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_new?: boolean
          last_checked_at?: string | null
          last_run_id?: string | null
          last_seen_at?: string
          owner_id: string
          page_name?: string
          seen_state?: string
          source_ad_id: string
          source_page_id?: string | null
          source_path?: string | null
          source_url?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          ad_text?: string
          changed_at?: string | null
          competitor_id?: string | null
          content_hash?: string | null
          created_at?: string
          discovered_at?: string | null
          discovery_domain_id?: string | null
          discovery_keys?: string[]
          discovery_run_id?: string | null
          end_date?: string | null
          first_run_id?: string | null
          first_seen_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_new?: boolean
          last_checked_at?: string | null
          last_run_id?: string | null
          last_seen_at?: string
          owner_id?: string
          page_name?: string
          seen_state?: string
          source_ad_id?: string
          source_page_id?: string | null
          source_path?: string | null
          source_url?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_raw_ads_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          competitor_name: string
          competitor_url: string
          crawl_error: string | null
          crawl_status: string | null
          created_at: string
          id: string
          is_demo: boolean
          last_crawled_at: string | null
          niche: string
          owner_id: string | null
          platform: string
          source_page_id: string | null
          updated_at: string
        }
        Insert: {
          competitor_name: string
          competitor_url: string
          crawl_error?: string | null
          crawl_status?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          last_crawled_at?: string | null
          niche: string
          owner_id?: string | null
          platform: string
          source_page_id?: string | null
          updated_at?: string
        }
        Update: {
          competitor_name?: string
          competitor_url?: string
          crawl_error?: string | null
          crawl_status?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          last_crawled_at?: string | null
          niche?: string
          owner_id?: string | null
          platform?: string
          source_page_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      deleted_items: {
        Row: {
          block_key: string
          deleted_at: string
          id: string
          item_type: string
          label: string
          owner_id: string
          snapshot: Json
        }
        Insert: {
          block_key: string
          deleted_at?: string
          id?: string
          item_type: string
          label?: string
          owner_id: string
          snapshot?: Json
        }
        Update: {
          block_key?: string
          deleted_at?: string
          id?: string
          item_type?: string
          label?: string
          owner_id?: string
          snapshot?: Json
        }
        Relationships: []
      }
      discovered_competitors: {
        Row: {
          active_ads: number
          ads_sample: string | null
          category: string | null
          classification: string
          classification_note: string | null
          classified_at: string | null
          competitor_name: string
          competitor_url: string
          confidence: number | null
          created_at: string
          discovery_source: string
          fb_categories: string[]
          first_seen_at: string
          id: string
          last_seen_at: string
          likes: number | null
          matched_product_ids: string[]
          matched_terms: string[]
          owner_id: string
          platform: string
          posts_sample: string | null
          source_competitor_id: string
          times_seen: number
          updated_at: string
        }
        Insert: {
          active_ads?: number
          ads_sample?: string | null
          category?: string | null
          classification?: string
          classification_note?: string | null
          classified_at?: string | null
          competitor_name: string
          competitor_url: string
          confidence?: number | null
          created_at?: string
          discovery_source?: string
          fb_categories?: string[]
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          likes?: number | null
          matched_product_ids?: string[]
          matched_terms?: string[]
          owner_id?: string
          platform?: string
          posts_sample?: string | null
          source_competitor_id: string
          times_seen?: number
          updated_at?: string
        }
        Update: {
          active_ads?: number
          ads_sample?: string | null
          category?: string | null
          classification?: string
          classification_note?: string | null
          classified_at?: string | null
          competitor_name?: string
          competitor_url?: string
          confidence?: number | null
          created_at?: string
          discovery_source?: string
          fb_categories?: string[]
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          likes?: number | null
          matched_product_ids?: string[]
          matched_terms?: string[]
          owner_id?: string
          platform?: string
          posts_sample?: string | null
          source_competitor_id?: string
          times_seen?: number
          updated_at?: string
        }
        Relationships: []
      }
      discovery_terms: {
        Row: {
          created_at: string
          hits: number
          id: string
          kind: string
          last_searched_at: string | null
          owner_id: string
          removed_at: string | null
          source: string
          status: string
          term: string
          term_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hits?: number
          id?: string
          kind?: string
          last_searched_at?: string | null
          owner_id?: string
          removed_at?: string | null
          source?: string
          status?: string
          term: string
          term_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hits?: number
          id?: string
          kind?: string
          last_searched_at?: string | null
          owner_id?: string
          removed_at?: string | null
          source?: string
          status?: string
          term?: string
          term_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      domain_discovery_pages: {
        Row: {
          activity: string | null
          ads_count: number
          ai_result: Json | null
          analyzed_at: string | null
          competitor_id: string | null
          created_at: string
          decision: string | null
          domain_id: string
          id: string
          image_url: string | null
          last_ad_at: string | null
          owner_id: string
          page_id: string
          page_name: string
          page_url: string
          reason: string | null
          run_id: string | null
          search_keys: string[]
          status: string
          updated_at: string
          user_status: string
        }
        Insert: {
          activity?: string | null
          ads_count?: number
          ai_result?: Json | null
          analyzed_at?: string | null
          competitor_id?: string | null
          created_at?: string
          decision?: string | null
          domain_id: string
          id?: string
          image_url?: string | null
          last_ad_at?: string | null
          owner_id: string
          page_id: string
          page_name?: string
          page_url?: string
          reason?: string | null
          run_id?: string | null
          search_keys?: string[]
          status?: string
          updated_at?: string
          user_status?: string
        }
        Update: {
          activity?: string | null
          ads_count?: number
          ai_result?: Json | null
          analyzed_at?: string | null
          competitor_id?: string | null
          created_at?: string
          decision?: string | null
          domain_id?: string
          id?: string
          image_url?: string | null
          last_ad_at?: string | null
          owner_id?: string
          page_id?: string
          page_name?: string
          page_url?: string
          reason?: string | null
          run_id?: string | null
          search_keys?: string[]
          status?: string
          updated_at?: string
          user_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_discovery_pages_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_discovery_pages_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "competitor_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_discovery_pages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "domain_discovery_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_discovery_runs: {
        Row: {
          ads_found: number
          ads_new: number
          control: string
          created_at: string
          deadline_at: string | null
          domain_id: string
          error: string | null
          existing: number
          finished_at: string | null
          id: string
          keys_done: number
          keys_failed: number
          keys_total: number
          keywords: string[]
          note: string | null
          owner_id: string
          pages_analyzed: number
          pages_found: number
          phase: string
          rejected_skipped: number
          started_at: string
          status: string
          suggested: number
          updated_at: string
        }
        Insert: {
          ads_found?: number
          ads_new?: number
          control?: string
          created_at?: string
          deadline_at?: string | null
          domain_id: string
          error?: string | null
          existing?: number
          finished_at?: string | null
          id?: string
          keys_done?: number
          keys_failed?: number
          keys_total?: number
          keywords?: string[]
          note?: string | null
          owner_id: string
          pages_analyzed?: number
          pages_found?: number
          phase?: string
          rejected_skipped?: number
          started_at?: string
          status?: string
          suggested?: number
          updated_at?: string
        }
        Update: {
          ads_found?: number
          ads_new?: number
          control?: string
          created_at?: string
          deadline_at?: string | null
          domain_id?: string
          error?: string | null
          existing?: number
          finished_at?: string | null
          id?: string
          keys_done?: number
          keys_failed?: number
          keys_total?: number
          keywords?: string[]
          note?: string | null
          owner_id?: string
          pages_analyzed?: number
          pages_found?: number
          phase?: string
          rejected_skipped?: number
          started_at?: string
          status?: string
          suggested?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_discovery_runs_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "competitor_domains"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_page_rejections: {
        Row: {
          created_at: string
          domain_id: string
          id: string
          owner_id: string
          page_id: string
        }
        Insert: {
          created_at?: string
          domain_id: string
          id?: string
          owner_id: string
          page_id: string
        }
        Update: {
          created_at?: string
          domain_id?: string
          id?: string
          owner_id?: string
          page_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_page_rejections_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "competitor_domains"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_recheck_runs: {
        Row: {
          completed: number
          created_at: string
          cutoff_at: string
          failed: number
          finished_at: string | null
          id: string
          last_raw_ad_id: string | null
          lease_until: string | null
          needs_review: number
          owner_id: string
          processed: number
          started_at: string
          status: string
          stop_reason: string | null
          total: number
          updated_at: string
        }
        Insert: {
          completed?: number
          created_at?: string
          cutoff_at?: string
          failed?: number
          finished_at?: string | null
          id?: string
          last_raw_ad_id?: string | null
          lease_until?: string | null
          needs_review?: number
          owner_id: string
          processed?: number
          started_at?: string
          status?: string
          stop_reason?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          completed?: number
          created_at?: string
          cutoff_at?: string
          failed?: number
          finished_at?: string | null
          id?: string
          last_raw_ad_id?: string | null
          lease_until?: string | null
          needs_review?: number
          owner_id?: string
          processed?: number
          started_at?: string
          status?: string
          stop_reason?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      job_worker_lease: {
        Row: {
          id: boolean
          last_result: string | null
          last_tick_at: string | null
          lease_expires_at: string | null
        }
        Insert: {
          id?: boolean
          last_result?: string | null
          last_tick_at?: string | null
          lease_expires_at?: string | null
        }
        Update: {
          id?: boolean
          last_result?: string | null
          last_tick_at?: string | null
          lease_expires_at?: string | null
        }
        Relationships: []
      }
      metrics: {
        Row: {
          calculation_definition: Json
          condition_type: string
          created_at: string
          data_source: string
          default_max: number | null
          default_min: number | null
          default_scoring_method: string
          default_target: number | null
          default_weight: number
          description: string
          higher_is_better: boolean
          id: string
          is_active: boolean
          is_available: boolean
          metric_key: string
          name: string
          sort_order: number
          updated_at: string
          value_type: string
        }
        Insert: {
          calculation_definition?: Json
          condition_type?: string
          created_at?: string
          data_source: string
          default_max?: number | null
          default_min?: number | null
          default_scoring_method?: string
          default_target?: number | null
          default_weight?: number
          description: string
          higher_is_better?: boolean
          id?: string
          is_active?: boolean
          is_available?: boolean
          metric_key: string
          name: string
          sort_order?: number
          updated_at?: string
          value_type: string
        }
        Update: {
          calculation_definition?: Json
          condition_type?: string
          created_at?: string
          data_source?: string
          default_max?: number | null
          default_min?: number | null
          default_scoring_method?: string
          default_target?: number | null
          default_weight?: number
          description?: string
          higher_is_better?: boolean
          id?: string
          is_active?: boolean
          is_available?: boolean
          metric_key?: string
          name?: string
          sort_order?: number
          updated_at?: string
          value_type?: string
        }
        Relationships: []
      }
      openai_topups: {
        Row: {
          amount_usd: number
          created_at: string
          created_by: string | null
          credited_at: string
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          created_by?: string | null
          credited_at?: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          created_by?: string | null
          credited_at?: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_numbers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          number: string
          provider: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          number: string
          provider?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          number?: string
          provider?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_requests: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          note: string | null
          owner_id: string
          proof_path: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          owner_id: string
          proof_path: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          owner_id?: string
          proof_path?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pb_link_reviews: {
        Row: {
          confidence: string
          create_new_problem: boolean
          created_at: string
          decided_at: string | null
          id: string
          link_id: string
          new_problem_description: string | null
          new_problem_reason: string | null
          owner_id: string
          product_id: string
          reason: string
          reviewed_at: string
          statement_id: string
          status: string
          status_note: string | null
          suggested_problem_id: string | null
          suggested_reason: string | null
          updated_at: string
          verdict: string
        }
        Insert: {
          confidence?: string
          create_new_problem?: boolean
          created_at?: string
          decided_at?: string | null
          id?: string
          link_id: string
          new_problem_description?: string | null
          new_problem_reason?: string | null
          owner_id: string
          product_id: string
          reason?: string
          reviewed_at?: string
          statement_id: string
          status?: string
          status_note?: string | null
          suggested_problem_id?: string | null
          suggested_reason?: string | null
          updated_at?: string
          verdict: string
        }
        Update: {
          confidence?: string
          create_new_problem?: boolean
          created_at?: string
          decided_at?: string | null
          id?: string
          link_id?: string
          new_problem_description?: string | null
          new_problem_reason?: string | null
          owner_id?: string
          product_id?: string
          reason?: string
          reviewed_at?: string
          statement_id?: string
          status?: string
          status_note?: string | null
          suggested_problem_id?: string | null
          suggested_reason?: string | null
          updated_at?: string
          verdict?: string
        }
        Relationships: []
      }
      pb_merge_reviews: {
        Row: {
          confidence: string
          created_at: string
          decided_at: string | null
          id: string
          owner_id: string
          reason: string
          reviewed_at: string
          source_statement_id: string
          status: string
          status_note: string | null
          target_statement_id: string
          updated_at: string
          verdict: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          owner_id: string
          reason?: string
          reviewed_at?: string
          source_statement_id: string
          status?: string
          status_note?: string | null
          target_statement_id: string
          updated_at?: string
          verdict: string
        }
        Update: {
          confidence?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          owner_id?: string
          reason?: string
          reviewed_at?: string
          source_statement_id?: string
          status?: string
          status_note?: string | null
          target_statement_id?: string
          updated_at?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "pb_merge_reviews_source_statement_id_fkey"
            columns: ["source_statement_id"]
            isOneToOne: false
            referencedRelation: "pb_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pb_merge_reviews_target_statement_id_fkey"
            columns: ["target_statement_id"]
            isOneToOne: false
            referencedRelation: "pb_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      pb_review_jobs: {
        Row: {
          created_at: string
          current_text: string
          cursor: number
          failed: number
          id: string
          kind: string
          lease_expires_at: string | null
          log: Json
          owner_id: string
          problem_ids: string[]
          reviewed: number
          status: string
          total: number
          updated_at: string
          wake_base: string | null
        }
        Insert: {
          created_at?: string
          current_text?: string
          cursor?: number
          failed?: number
          id?: string
          kind: string
          lease_expires_at?: string | null
          log?: Json
          owner_id: string
          problem_ids?: string[]
          reviewed?: number
          status?: string
          total?: number
          updated_at?: string
          wake_base?: string | null
        }
        Update: {
          created_at?: string
          current_text?: string
          cursor?: number
          failed?: number
          id?: string
          kind?: string
          lease_expires_at?: string | null
          log?: Json
          owner_id?: string
          problem_ids?: string[]
          reviewed?: number
          status?: string
          total?: number
          updated_at?: string
          wake_base?: string | null
        }
        Relationships: []
      }
      pb_statement_products: {
        Row: {
          confidence: number | null
          created_at: string
          evidence: string
          id: string
          owner_id: string
          product_id: string
          source: string
          statement_id: string
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence?: string
          id?: string
          owner_id: string
          product_id: string
          source?: string
          statement_id: string
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence?: string
          id?: string
          owner_id?: string
          product_id?: string
          source?: string
          statement_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pb_statement_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pb_statement_products_statement_fk"
            columns: ["statement_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "pb_statements"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      pb_statements: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string
          display_text: string
          id: string
          kind: string
          merged_into: string | null
          normalized_key: string
          normalizer_version: number
          owner_id: string
          test_run_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string
          display_text: string
          id?: string
          kind: string
          merged_into?: string | null
          normalized_key: string
          normalizer_version?: number
          owner_id: string
          test_run_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string
          display_text?: string
          id?: string
          kind?: string
          merged_into?: string | null
          normalized_key?: string
          normalizer_version?: number
          owner_id?: string
          test_run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pb_statements_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "pb_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pb_statements_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "pb_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pb_test_run_ads: {
        Row: {
          ad_id: string
          created_at: string
          error: string | null
          id: string
          owner_id: string
          processed_at: string | null
          result: Json | null
          run_id: string
          status: string
          summary: Json | null
        }
        Insert: {
          ad_id: string
          created_at?: string
          error?: string | null
          id?: string
          owner_id: string
          processed_at?: string | null
          result?: Json | null
          run_id: string
          status?: string
          summary?: Json | null
        }
        Update: {
          ad_id?: string
          created_at?: string
          error?: string | null
          id?: string
          owner_id?: string
          processed_at?: string | null
          result?: Json | null
          run_id?: string
          status?: string
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "pb_test_run_ads_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pb_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pb_test_runs: {
        Row: {
          ad_ids: string[]
          created_at: string
          finished_at: string | null
          id: string
          label: string
          owner_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          ad_ids: string[]
          created_at?: string
          finished_at?: string | null
          id?: string
          label: string
          owner_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          ad_ids?: string[]
          created_at?: string
          finished_at?: string | null
          id?: string
          label?: string
          owner_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      pcrawl_ads: {
        Row: {
          ad_id: string
          ad_text: string
          analyzed_at: string | null
          created_at: string
          error: string | null
          extracted: Json | null
          extracted_name: string | null
          first_seen_at: string
          id: string
          image_url: string | null
          is_active: boolean
          last_seen_at: string
          owner_id: string
          page_id: string | null
          page_name: string
          page_url: string
          run_id: string | null
          source_url: string | null
          started_on: string | null
          status: string
          target_product_ids: string[]
          updated_at: string
          via_keys: string[]
        }
        Insert: {
          ad_id: string
          ad_text?: string
          analyzed_at?: string | null
          created_at?: string
          error?: string | null
          extracted?: Json | null
          extracted_name?: string | null
          first_seen_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          last_seen_at?: string
          owner_id: string
          page_id?: string | null
          page_name?: string
          page_url?: string
          run_id?: string | null
          source_url?: string | null
          started_on?: string | null
          status?: string
          target_product_ids?: string[]
          updated_at?: string
          via_keys?: string[]
        }
        Update: {
          ad_id?: string
          ad_text?: string
          analyzed_at?: string | null
          created_at?: string
          error?: string | null
          extracted?: Json | null
          extracted_name?: string | null
          first_seen_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          last_seen_at?: string
          owner_id?: string
          page_id?: string | null
          page_name?: string
          page_url?: string
          run_id?: string | null
          source_url?: string | null
          started_on?: string | null
          status?: string
          target_product_ids?: string[]
          updated_at?: string
          via_keys?: string[]
        }
        Relationships: []
      }
      pcrawl_keys: {
        Row: {
          created_at: string
          found: number
          id: string
          key_key: string
          key_text: string
          kind: string
          owner_id: string
          product_ids: string[]
          run_id: string
          searched_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          found?: number
          id?: string
          key_key: string
          key_text: string
          kind?: string
          owner_id: string
          product_ids?: string[]
          run_id: string
          searched_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          found?: number
          id?: string
          key_key?: string
          key_text?: string
          kind?: string
          owner_id?: string
          product_ids?: string[]
          run_id?: string
          searched_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcrawl_keys_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pcrawl_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pcrawl_matches: {
        Row: {
          ad_id: string
          created_at: string
          decision: string
          differences: string[]
          extracted_name: string | null
          id: string
          owner_id: string
          page_id: string | null
          page_name: string
          pcrawl_ad_id: string
          product_id: string
          reasons: string[]
          run_id: string | null
          score: number
          search_key: string | null
          updated_at: string
        }
        Insert: {
          ad_id: string
          created_at?: string
          decision?: string
          differences?: string[]
          extracted_name?: string | null
          id?: string
          owner_id: string
          page_id?: string | null
          page_name?: string
          pcrawl_ad_id: string
          product_id: string
          reasons?: string[]
          run_id?: string | null
          score?: number
          search_key?: string | null
          updated_at?: string
        }
        Update: {
          ad_id?: string
          created_at?: string
          decision?: string
          differences?: string[]
          extracted_name?: string | null
          id?: string
          owner_id?: string
          page_id?: string | null
          page_name?: string
          pcrawl_ad_id?: string
          product_id?: string
          reasons?: string[]
          run_id?: string | null
          score?: number
          search_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcrawl_matches_pcrawl_ad_id_fkey"
            columns: ["pcrawl_ad_id"]
            isOneToOne: false
            referencedRelation: "pcrawl_ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcrawl_matches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pcrawl_profiles: {
        Row: {
          built_at: string | null
          created_at: string
          id: string
          owner_id: string
          product_id: string
          research: Json
          updated_at: string
        }
        Insert: {
          built_at?: string | null
          created_at?: string
          id?: string
          owner_id: string
          product_id: string
          research?: Json
          updated_at?: string
        }
        Update: {
          built_at?: string | null
          created_at?: string
          id?: string
          owner_id?: string
          product_id?: string
          research?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcrawl_profiles_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pcrawl_runs: {
        Row: {
          ads_analyzed: number
          ads_found: number
          ads_new: number
          control: string
          created_at: string
          deadline_at: string | null
          error: string | null
          finished_at: string | null
          id: string
          keys_done: number
          keys_total: number
          lease_expires_at: string | null
          matches: number
          note: string | null
          owner_id: string
          pages_candidates: number
          product_ids: string[]
          profiles_built: number
          scope: string
          started_at: string
          status: string
          trigger_type: string
          updated_at: string
        }
        Insert: {
          ads_analyzed?: number
          ads_found?: number
          ads_new?: number
          control?: string
          created_at?: string
          deadline_at?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          keys_done?: number
          keys_total?: number
          lease_expires_at?: string | null
          matches?: number
          note?: string | null
          owner_id: string
          pages_candidates?: number
          product_ids?: string[]
          profiles_built?: number
          scope?: string
          started_at?: string
          status?: string
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          ads_analyzed?: number
          ads_found?: number
          ads_new?: number
          control?: string
          created_at?: string
          deadline_at?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          keys_done?: number
          keys_total?: number
          lease_expires_at?: string | null
          matches?: number
          note?: string | null
          owner_id?: string
          pages_candidates?: number
          product_ids?: string[]
          profiles_built?: number
          scope?: string
          started_at?: string
          status?: string
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      pcrawl_state: {
        Row: {
          created_at: string
          cycles: number
          last_run_at: string | null
          owner_id: string
          paused_at: string | null
          paused_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cycles?: number
          last_run_at?: string | null
          owner_id: string
          paused_at?: string | null
          paused_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cycles?: number
          last_run_at?: string | null
          owner_id?: string
          paused_at?: string | null
          paused_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pcrawl_targets: {
        Row: {
          created_at: string
          id: string
          last_targeted_at: string | null
          owner_id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_targeted_at?: string | null
          owner_id: string
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_targeted_at?: string | null
          owner_id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcrawl_targets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_aliases: {
        Row: {
          alias_key: string
          alias_name: string
          created_at: string
          id: string
          owner_id: string
          product_id: string
        }
        Insert: {
          alias_key: string
          alias_name: string
          created_at?: string
          id?: string
          owner_id?: string
          product_id: string
        }
        Update: {
          alias_key?: string
          alias_name?: string
          created_at?: string
          id?: string
          owner_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_code_overrides: {
        Row: {
          code: string
          created_at: string
          id: string
          owner_id: string
          product_key: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          owner_id?: string
          product_key: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          owner_id?: string
          product_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          canonical_key: string
          canonical_name: string
          code: string
          created_at: string
          created_from_ad_id: string | null
          created_from_source_ad_id: string | null
          id: string
          image_url: string | null
          is_demo: boolean
          owner_id: string
          profile: Json
          profile_updated_at: string | null
          updated_at: string
        }
        Insert: {
          canonical_key: string
          canonical_name: string
          code: string
          created_at?: string
          created_from_ad_id?: string | null
          created_from_source_ad_id?: string | null
          id?: string
          image_url?: string | null
          is_demo?: boolean
          owner_id?: string
          profile?: Json
          profile_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          canonical_key?: string
          canonical_name?: string
          code?: string
          created_at?: string
          created_from_ad_id?: string | null
          created_from_source_ad_id?: string | null
          id?: string
          image_url?: string | null
          is_demo?: boolean
          owner_id?: string
          profile?: Json
          profile_updated_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          bio: string
          created_at: string
          dark_mode: boolean
          full_name: string
          id: string
          interface_language: string
          job_title: string
          phone: string
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string
          created_at?: string
          dark_mode?: boolean
          full_name?: string
          id: string
          interface_language?: string
          job_title?: string
          phone?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string
          created_at?: string
          dark_mode?: boolean
          full_name?: string
          id?: string
          interface_language?: string
          job_title?: string
          phone?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_source_info: {
        Row: {
          db_display_name: string | null
          default_branch: string | null
          id: boolean
          last_branch: string | null
          last_commit_at: string | null
          last_commit_message: string | null
          last_commit_sha: string | null
          last_event: string | null
          last_pusher: string | null
          last_sync_error: string | null
          project_display_name: string | null
          push_count: number
          repo_full_name: string | null
          repo_owner: string | null
          repo_url: string | null
          updated_at: string
          webhook_id: number | null
        }
        Insert: {
          db_display_name?: string | null
          default_branch?: string | null
          id?: boolean
          last_branch?: string | null
          last_commit_at?: string | null
          last_commit_message?: string | null
          last_commit_sha?: string | null
          last_event?: string | null
          last_pusher?: string | null
          last_sync_error?: string | null
          project_display_name?: string | null
          push_count?: number
          repo_full_name?: string | null
          repo_owner?: string | null
          repo_url?: string | null
          updated_at?: string
          webhook_id?: number | null
        }
        Update: {
          db_display_name?: string | null
          default_branch?: string | null
          id?: boolean
          last_branch?: string | null
          last_commit_at?: string | null
          last_commit_message?: string | null
          last_commit_sha?: string | null
          last_event?: string | null
          last_pusher?: string | null
          last_sync_error?: string | null
          project_display_name?: string | null
          push_count?: number
          repo_full_name?: string | null
          repo_owner?: string | null
          repo_url?: string | null
          updated_at?: string
          webhook_id?: number | null
        }
        Relationships: []
      }
      raw_ad_analyses: {
        Row: {
          ad_id: string | null
          analysis_version: string | null
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          match_score: number | null
          match_status: string | null
          max_attempts: number
          model: string | null
          next_attempt_at: string
          owner_id: string
          processing_completed_at: string | null
          processing_started_at: string | null
          product_id: string | null
          raw_ad_id: string
          result: Json | null
          source_ad_id: string
          status: string
          updated_at: string
        }
        Insert: {
          ad_id?: string | null
          analysis_version?: string | null
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          match_score?: number | null
          match_status?: string | null
          max_attempts?: number
          model?: string | null
          next_attempt_at?: string
          owner_id: string
          processing_completed_at?: string | null
          processing_started_at?: string | null
          product_id?: string | null
          raw_ad_id: string
          result?: Json | null
          source_ad_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          ad_id?: string | null
          analysis_version?: string | null
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          match_score?: number | null
          match_status?: string | null
          max_attempts?: number
          model?: string | null
          next_attempt_at?: string
          owner_id?: string
          processing_completed_at?: string | null
          processing_started_at?: string | null
          product_id?: string | null
          raw_ad_id?: string
          result?: Json | null
          source_ad_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_ad_analyses_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_ad_analyses_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads_with_duration"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_ad_analyses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_ad_analyses_raw_ad_id_fkey"
            columns: ["raw_ad_id"]
            isOneToOne: false
            referencedRelation: "competitor_raw_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_ad_analysis_control: {
        Row: {
          owner_id: string
          run_started_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          owner_id: string
          run_started_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          owner_id?: string
          run_started_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_ai_accounts: {
        Row: {
          balance_egp: number
          created_at: string
          held_egp: number
          trial_tokens_remaining: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_egp?: number
          created_at?: string
          held_egp?: number
          trial_tokens_remaining?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_egp?: number
          created_at?: string
          held_egp?: number
          trial_tokens_remaining?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_metric_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          maximum_value: number | null
          metric_id: string
          minimum_value: number | null
          owner_id: string
          scoring_method: string
          target_value: number | null
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          maximum_value?: number | null
          metric_id: string
          minimum_value?: number | null
          owner_id?: string
          scoring_method?: string
          target_value?: number | null
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          maximum_value?: number | null
          metric_id?: string
          minimum_value?: number | null
          owner_id?: string
          scoring_method?: string
          target_value?: number | null
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_metric_settings_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metrics"
            referencedColumns: ["id"]
          },
        ]
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
      wallet_ledger: {
        Row: {
          amount_egp: number
          balance_after_egp: number
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          owner_id: string
          ref_id: string | null
          ref_type: string | null
        }
        Insert: {
          amount_egp: number
          balance_after_egp: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          note?: string | null
          owner_id: string
          ref_id?: string | null
          ref_type?: string | null
        }
        Update: {
          amount_egp?: number
          balance_after_egp?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          owner_id?: string
          ref_id?: string | null
          ref_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      ads_with_duration: {
        Row: {
          active_days: number | null
          canonical_product_name: string | null
          competitor_id: string | null
          computed_on_utc: string | null
          created_at: string | null
          creation_date: string | null
          duration_days: number | null
          end_date: string | null
          id: string | null
          image_url: string | null
          inactive_days: number | null
          last_seen_at: string | null
          owner_id: string | null
          product_code: string | null
          product_description: string | null
          product_id: string | null
          product_name: string | null
          source_ad_id: string | null
          source_platform: string | null
          source_url: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acquire_pcrawl_run: {
        Args: { _owner_id: string; _scope: string; _trigger_type: string }
        Returns: string
      }
      acquire_worker_lease: { Args: { _seconds: number }; Returns: boolean }
      approve_payment_request: {
        Args: { _request_id: string }
        Returns: undefined
      }
      arm_competitor_collect_backstop: { Args: never; Returns: undefined }
      call_app: { Args: { _path: string }; Returns: number }
      call_app_at: { Args: { _base: string; _path: string }; Returns: number }
      claim_competitor_jobs: {
        Args: { _lease_seconds?: number; _limit: number }
        Returns: {
          ads_changed: number
          ads_duplicate: number
          ads_found: number
          ads_new: number
          attempts: number
          batch: number
          competitor_id: string
          created_at: string
          cursor: string | null
          debug: Json | null
          error: string | null
          error_type: string | null
          finished_at: string | null
          has_more: boolean
          heartbeat_at: string | null
          id: string
          lease_expires_at: string | null
          max_attempts: number
          next_attempt_at: string
          owner_id: string
          path: string
          run_id: string
          started_at: string | null
          status: string
          updated_at: string
          url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "competitor_collection_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_legacy_records: {
        Args: never
        Returns: {
          claimed_ads: number
          claimed_competitors: number
        }[]
      }
      claim_legacy_records_for: {
        Args: { _uid: string }
        Returns: {
          claimed_ads: number
          claimed_competitors: number
        }[]
      }
      claim_raw_ad_analyses: {
        Args: { _lease_seconds?: number; _limit: number }
        Returns: {
          ad_id: string | null
          analysis_version: string | null
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          match_score: number | null
          match_status: string | null
          max_attempts: number
          model: string | null
          next_attempt_at: string
          owner_id: string
          processing_completed_at: string | null
          processing_started_at: string | null
          product_id: string | null
          raw_ad_id: string
          result: Json | null
          source_ad_id: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "raw_ad_analyses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_demo_data: { Args: never; Returns: undefined }
      competitor_collect_backstop: { Args: never; Returns: undefined }
      consume_trial_tokens: {
        Args: { _owner_id: string; _tokens: number }
        Returns: number
      }
      credit_wallet: {
        Args: {
          _amount: number
          _created_by?: string
          _kind: string
          _note?: string
          _owner_id: string
          _ref_id?: string
          _ref_type?: string
        }
        Returns: number
      }
      enqueue_raw_ad_analyses: { Args: { _limit?: number }; Returns: number }
      get_ads_filter_options: { Args: never; Returns: Json }
      get_ads_page: {
        Args: {
          _competitor_id?: string
          _limit?: number
          _offset?: number
          _rules?: Json
          _search?: string
          _status?: string
        }
        Returns: Json
      }
      get_competitors_page: {
        Args: {
          _ai_ids?: string[]
          _limit?: number
          _offset?: number
          _product?: string
          _rules?: Json
          _search?: string
          _sort?: string
        }
        Returns: Json
      }
      get_dashboard_summary: { Args: never; Returns: Json }
      get_discovery_cron_token: { Args: never; Returns: string }
      get_pb_statements_page: {
        Args: {
          _kind?: string
          _limit?: number
          _page?: number
          _search?: string
          _sort?: string
        }
        Returns: Json
      }
      get_products_page: {
        Args: {
          _ai_ids?: string[]
          _limit?: number
          _page?: number
          _rules?: Json
          _search?: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heartbeat_competitor_job: {
        Args: { _job_id: string; _lease_seconds?: number }
        Returns: boolean
      }
      hold_ai_balance: {
        Args: { _amount: number; _owner_id: string }
        Returns: string
      }
      kashaf_js_trim: { Args: { _s: string }; Returns: string }
      kashaf_product_code: { Args: { _name: string }; Returns: string }
      kashaf_product_key: { Args: { _name: string }; Returns: string }
      kashaf_utf16_len: { Args: { _s: string }; Returns: number }
      merge_pb_statements: {
        Args: { _canonical: string; _duplicates: string[]; _owner_id: string }
        Returns: number
      }
      pb_normalize_key_v1: { Args: { _s: string }; Returns: string }
      pb_normalize_v1: { Args: { _s: string }; Returns: string }
      refresh_competitor_run: { Args: { _run_id: string }; Returns: string }
      reject_payment_request: {
        Args: { _note?: string; _request_id: string }
        Returns: undefined
      }
      release_ai_hold: { Args: { _hold_id: string }; Returns: undefined }
      release_stale_ai_holds: { Args: { _owner_id?: string }; Returns: number }
      release_worker_lease: { Args: { _result: string }; Returns: undefined }
      seed_demo_data: { Args: { _uid: string }; Returns: undefined }
      settle_ai_hold: {
        Args: { _actual: number; _hold_id: string; _usage_id?: string }
        Returns: number
      }
      vault_get_secret: { Args: { _name: string }; Returns: string }
      vault_has_secret: { Args: { _name: string }; Returns: boolean }
      vault_set_secret: {
        Args: { _name: string; _value: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "user" | "admin"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["user", "admin"],
    },
  },
} as const
