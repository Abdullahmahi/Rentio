// Generated from the Rentio schema — do not edit by hand.
// Regenerate after a migration:  bun run db:types

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      access_requests: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          phone: string | null;
          property_hint: string | null;
          unit_hint: string | null;
          status: Database["public"]["Enums"]["access_request_status"];
          matched_tenant_id: string | null;
          note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          email: string;
          phone?: string | null;
          property_hint?: string | null;
          unit_hint?: string | null;
          status?: Database["public"]["Enums"]["access_request_status"];
          matched_tenant_id?: string | null;
          note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string;
          phone?: string | null;
          property_hint?: string | null;
          unit_hint?: string | null;
          status?: Database["public"]["Enums"]["access_request_status"];
          matched_tenant_id?: string | null;
          note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      activity_log: {
        Row: {
          id: string;
          actor_id: string | null;
          entity_type: string;
          entity_id: string | null;
          action: string;
          meta: Json;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          entity_type: string;
          entity_id?: string | null;
          action: string;
          meta?: Json;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          entity_type?: string;
          entity_id?: string | null;
          action?: string;
          meta?: Json;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      application_co_applicants: {
        Row: {
          id: string;
          org_id: string;
          application_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          relationship: string | null;
          monthly_income: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string;
          application_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          relationship?: string | null;
          monthly_income?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          application_id?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          relationship?: string | null;
          monthly_income?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      application_files: {
        Row: {
          id: string;
          org_id: string;
          application_id: string;
          kind: string;
          path: string;
          file_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string;
          application_id: string;
          kind?: string;
          path: string;
          file_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          application_id?: string;
          kind?: string;
          path?: string;
          file_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      application_links: {
        Row: {
          id: string;
          org_id: string;
          unit_id: string | null;
          token: string;
          active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string;
          unit_id?: string | null;
          token?: string;
          active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          unit_id?: string | null;
          token?: string;
          active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      application_reviews: {
        Row: {
          id: string;
          org_id: string;
          application_id: string;
          screening_result: string | null;
          screening_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          decision_note: string | null;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          org_id?: string;
          application_id: string;
          screening_result?: string | null;
          screening_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          decision_note?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          application_id?: string;
          screening_result?: string | null;
          screening_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          decision_note?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      applications: {
        Row: {
          id: string;
          org_id: string;
          unit_id: string | null;
          link_id: string | null;
          profile_id: string;
          status: string;
          full_name: string | null;
          email: string | null;
          phone: string | null;
          date_of_birth: string | null;
          current_address: string | null;
          desired_move_in: string | null;
          employer: string | null;
          job_title: string | null;
          employer_phone: string | null;
          employment_start: string | null;
          monthly_income: number | null;
          rental_history: Json;
          notes: string | null;
          submitted_at: string | null;
          tenant_id: string | null;
          lease_id: string | null;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          org_id?: string;
          unit_id?: string | null;
          link_id?: string | null;
          profile_id: string;
          status?: string;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          date_of_birth?: string | null;
          current_address?: string | null;
          desired_move_in?: string | null;
          employer?: string | null;
          job_title?: string | null;
          employer_phone?: string | null;
          employment_start?: string | null;
          monthly_income?: number | null;
          rental_history?: Json;
          notes?: string | null;
          submitted_at?: string | null;
          tenant_id?: string | null;
          lease_id?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          unit_id?: string | null;
          link_id?: string | null;
          profile_id?: string;
          status?: string;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          date_of_birth?: string | null;
          current_address?: string | null;
          desired_move_in?: string | null;
          employer?: string | null;
          job_title?: string | null;
          employer_phone?: string | null;
          employment_start?: string | null;
          monthly_income?: number | null;
          rental_history?: Json;
          notes?: string | null;
          submitted_at?: string | null;
          tenant_id?: string | null;
          lease_id?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          owner_type: string;
          owner_id: string;
          name: string;
          url: string;
          uploaded_by: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          owner_type: string;
          owner_id: string;
          name: string;
          url: string;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          owner_type?: string;
          owner_id?: string;
          name?: string;
          url?: string;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          unit_id: string;
          amount: number;
          spent_at: string;
          description: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          amount: number;
          spent_at?: string;
          description: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          amount?: number;
          spent_at?: string;
          description?: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      invoice_lines: {
        Row: {
          id: string;
          invoice_id: string;
          description: string;
          category: Database["public"]["Enums"]["line_category"];
          quantity: number;
          amount: number;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          invoice_id: string;
          description: string;
          category?: Database["public"]["Enums"]["line_category"];
          quantity?: number;
          amount?: number;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          description?: string;
          category?: Database["public"]["Enums"]["line_category"];
          quantity?: number;
          amount?: number;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          lease_id: string;
          period_month: string;
          invoice_number: string | null;
          issue_date: string;
          due_date: string;
          status: Database["public"]["Enums"]["invoice_status"];
          total: number;
          cancel_reason: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          lease_id: string;
          period_month: string;
          invoice_number?: string | null;
          issue_date?: string;
          due_date: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          total?: number;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          lease_id?: string;
          period_month?: string;
          invoice_number?: string | null;
          issue_date?: string;
          due_date?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          total?: number;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      job_runs: {
        Row: {
          id: string;
          org_id: string;
          trigger: string;
          actor_id: string | null;
          started_at: string;
          finished_at: string;
          summary: Json;
          error: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          trigger: string;
          actor_id?: string | null;
          started_at: string;
          finished_at?: string;
          summary?: Json;
          error?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          trigger?: string;
          actor_id?: string | null;
          started_at?: string;
          finished_at?: string;
          summary?: Json;
          error?: string | null;
        };
        Relationships: [];
      };
      late_fee_warnings: {
        Row: {
          invoice_id: string;
          org_id: string;
          eligible_on: string;
          sent_at: string | null;
          channel: string | null;
          created_at: string;
        };
        Insert: {
          invoice_id: string;
          org_id?: string;
          eligible_on: string;
          sent_at?: string | null;
          channel?: string | null;
          created_at?: string;
        };
        Update: {
          invoice_id?: string;
          org_id?: string;
          eligible_on?: string;
          sent_at?: string | null;
          channel?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      lease_notices: {
        Row: {
          id: string;
          lease_id: string;
          type: Database["public"]["Enums"]["notice_type"];
          reason: string | null;
          vacate_date: string;
          delivery: Database["public"]["Enums"]["notice_delivery"];
          delivered_at: string;
          document_url: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          lease_id: string;
          type: Database["public"]["Enums"]["notice_type"];
          reason?: string | null;
          vacate_date: string;
          delivery: Database["public"]["Enums"]["notice_delivery"];
          delivered_at?: string;
          document_url?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          lease_id?: string;
          type?: Database["public"]["Enums"]["notice_type"];
          reason?: string | null;
          vacate_date?: string;
          delivery?: Database["public"]["Enums"]["notice_delivery"];
          delivered_at?: string;
          document_url?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      lease_tenants: {
        Row: {
          id: string;
          lease_id: string;
          tenant_id: string;
          role: Database["public"]["Enums"]["lease_tenant_role"];
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          lease_id: string;
          tenant_id: string;
          role?: Database["public"]["Enums"]["lease_tenant_role"];
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          lease_id?: string;
          tenant_id?: string;
          role?: Database["public"]["Enums"]["lease_tenant_role"];
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      leases: {
        Row: {
          id: string;
          unit_id: string;
          start_date: string;
          end_date: string;
          rent_amount: number;
          rent_due_day: number;
          grace_days: number;
          late_fee_amount: number;
          deposit_amount: number;
          deposit_status: string;
          deposit_refunded: number | null;
          deposit_retained: number | null;
          deposit_notes: string | null;
          status: Database["public"]["Enums"]["lease_status"];
          contract_url: string | null;
          move_out_date: string | null;
          created_at: string;
          updated_at: string | null;
          late_fee_type: Database["public"]["Enums"]["late_fee_type"];
          late_fee_percent: number;
          late_fee_over_cap_ack: boolean;
          surrender_date: string | null;
          forwarding_address: string | null;
          forwarding_address_received_at: string | null;
          deposit_due_date: string | null;
          deposit_settled_at: string | null;
          deposit_itemization: Json;
          move_out_notes: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          start_date: string;
          end_date: string;
          rent_amount: number;
          rent_due_day?: number;
          grace_days?: number;
          late_fee_amount?: number;
          deposit_amount?: number;
          deposit_status?: string;
          deposit_refunded?: number | null;
          deposit_retained?: number | null;
          deposit_notes?: string | null;
          status?: Database["public"]["Enums"]["lease_status"];
          contract_url?: string | null;
          move_out_date?: string | null;
          created_at?: string;
          updated_at?: string | null;
          late_fee_type?: Database["public"]["Enums"]["late_fee_type"];
          late_fee_percent?: number;
          late_fee_over_cap_ack?: boolean;
          surrender_date?: string | null;
          forwarding_address?: string | null;
          forwarding_address_received_at?: string | null;
          deposit_due_date?: string | null;
          deposit_settled_at?: string | null;
          deposit_itemization?: Json;
          move_out_notes?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          start_date?: string;
          end_date?: string;
          rent_amount?: number;
          rent_due_day?: number;
          grace_days?: number;
          late_fee_amount?: number;
          deposit_amount?: number;
          deposit_status?: string;
          deposit_refunded?: number | null;
          deposit_retained?: number | null;
          deposit_notes?: string | null;
          status?: Database["public"]["Enums"]["lease_status"];
          contract_url?: string | null;
          move_out_date?: string | null;
          created_at?: string;
          updated_at?: string | null;
          late_fee_type?: Database["public"]["Enums"]["late_fee_type"];
          late_fee_percent?: number;
          late_fee_over_cap_ack?: boolean;
          surrender_date?: string | null;
          forwarding_address?: string | null;
          forwarding_address_received_at?: string | null;
          deposit_due_date?: string | null;
          deposit_settled_at?: string | null;
          deposit_itemization?: Json;
          move_out_notes?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          org_id: string;
          tenant_id: string;
          lease_id: string | null;
          kind: string;
          entity_id: string | null;
          dedupe_key: string;
          payload: Json;
          created_at: string;
          sent_at: string | null;
          channel: string | null;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          tenant_id: string;
          lease_id?: string | null;
          kind: string;
          entity_id?: string | null;
          dedupe_key: string;
          payload?: Json;
          created_at?: string;
          sent_at?: string | null;
          channel?: string | null;
          read_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          tenant_id?: string;
          lease_id?: string | null;
          kind?: string;
          entity_id?: string | null;
          dedupe_key?: string;
          payload?: Json;
          created_at?: string;
          sent_at?: string | null;
          channel?: string | null;
          read_at?: string | null;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          clerk_org_id: string | null;
          name: string;
          slug: string;
          plan: string;
          doors_limit: number | null;
          status: string;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          clerk_org_id?: string | null;
          name: string;
          slug: string;
          plan?: string;
          doors_limit?: number | null;
          status?: string;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          clerk_org_id?: string | null;
          name?: string;
          slug?: string;
          plan?: string;
          doors_limit?: number | null;
          status?: string;
          created_at?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      parking_spaces: {
        Row: {
          id: string;
          property_id: string;
          label: string;
          type: string;
          monthly_fee: number;
          status: string;
          lease_id: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          label: string;
          type?: string;
          monthly_fee?: number;
          status?: string;
          lease_id?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          label?: string;
          type?: string;
          monthly_fee?: number;
          status?: string;
          lease_id?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      payment_allocations: {
        Row: {
          id: string;
          payment_id: string;
          invoice_id: string;
          amount: number;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          payment_id: string;
          invoice_id: string;
          amount: number;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          payment_id?: string;
          invoice_id?: string;
          amount?: number;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          lease_id: string;
          amount: number;
          paid_at: string;
          method: Database["public"]["Enums"]["payment_method"];
          reference: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          receipt_url: string | null;
          reported_by_tenant: boolean;
          recorded_by: string | null;
          confirmed_by: string | null;
          confirmed_at: string | null;
          void_reason: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          lease_id: string;
          amount: number;
          paid_at?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          reference?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          receipt_url?: string | null;
          reported_by_tenant?: boolean;
          recorded_by?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          void_reason?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          lease_id?: string;
          amount?: number;
          paid_at?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          reference?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          receipt_url?: string | null;
          reported_by_tenant?: boolean;
          recorded_by?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          void_reason?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          locale: string | null;
          tenant_id: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string | null;
          clerk_user_id: string | null;
          email: string | null;
          org_id: string | null;
        };
        Insert: {
          id?: string;
          full_name?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          locale?: string | null;
          tenant_id?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string | null;
          clerk_user_id?: string | null;
          email?: string | null;
          org_id?: string | null;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          locale?: string | null;
          tenant_id?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string | null;
          clerk_user_id?: string | null;
          email?: string | null;
          org_id?: string | null;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          id: string;
          name: string;
          street: string | null;
          address_line_2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string | null;
          units_in_structure: number | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          name: string;
          street?: string | null;
          address_line_2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          units_in_structure?: number | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          name?: string;
          street?: string | null;
          address_line_2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          units_in_structure?: number | null;
          org_id?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          id: string;
          company_name: string;
          logo_url: string | null;
          invoice_prefix: string;
          default_grace_days: number;
          street: string | null;
          address_line_2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          phone: string | null;
          email: string | null;
          created_at: string;
          updated_at: string | null;
          zelle_handle: string | null;
          check_payable_to: string | null;
          check_mailing_address: string | null;
          dropoff_address: string | null;
          office_hours: string | null;
          payment_notes: string | null;
          nsf_fee: number;
          default_late_fee_percent: number;
          org_id: string;
          auto_invoice_day: number;
          auto_invoice_send: boolean;
          auto_rent_reminder: boolean;
          auto_rent_reminder_days: number;
          auto_late_fee_warning: boolean;
          auto_payment_emails: boolean;
          auto_repair_emails: boolean;
        };
        Insert: {
          id?: string;
          company_name?: string;
          logo_url?: string | null;
          invoice_prefix?: string;
          default_grace_days?: number;
          street?: string | null;
          address_line_2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          phone?: string | null;
          email?: string | null;
          created_at?: string;
          updated_at?: string | null;
          zelle_handle?: string | null;
          check_payable_to?: string | null;
          check_mailing_address?: string | null;
          dropoff_address?: string | null;
          office_hours?: string | null;
          payment_notes?: string | null;
          nsf_fee?: number;
          default_late_fee_percent?: number;
          org_id?: string;
          auto_invoice_day?: number;
          auto_invoice_send?: boolean;
          auto_rent_reminder?: boolean;
          auto_rent_reminder_days?: number;
          auto_late_fee_warning?: boolean;
          auto_payment_emails?: boolean;
          auto_repair_emails?: boolean;
        };
        Update: {
          id?: string;
          company_name?: string;
          logo_url?: string | null;
          invoice_prefix?: string;
          default_grace_days?: number;
          street?: string | null;
          address_line_2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          phone?: string | null;
          email?: string | null;
          created_at?: string;
          updated_at?: string | null;
          zelle_handle?: string | null;
          check_payable_to?: string | null;
          check_mailing_address?: string | null;
          dropoff_address?: string | null;
          office_hours?: string | null;
          payment_notes?: string | null;
          nsf_fee?: number;
          default_late_fee_percent?: number;
          org_id?: string;
          auto_invoice_day?: number;
          auto_invoice_send?: boolean;
          auto_rent_reminder?: boolean;
          auto_rent_reminder_days?: number;
          auto_late_fee_warning?: boolean;
          auto_payment_emails?: boolean;
          auto_repair_emails?: boolean;
        };
        Relationships: [];
      };
      signature_requests: {
        Row: {
          id: string;
          org_id: string;
          lease_id: string;
          title: string;
          message: string | null;
          original_path: string;
          original_sha256: string;
          page_count: number;
          signed_path: string | null;
          signed_sha256: string | null;
          status: string;
          created_by: string | null;
          created_at: string;
          expires_at: string;
          finalizing_at: string | null;
          completed_at: string | null;
          voided_at: string | null;
        };
        Insert: {
          id?: string;
          org_id?: string;
          lease_id: string;
          title: string;
          message?: string | null;
          original_path: string;
          original_sha256: string;
          page_count: number;
          signed_path?: string | null;
          signed_sha256?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          expires_at: string;
          finalizing_at?: string | null;
          completed_at?: string | null;
          voided_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          lease_id?: string;
          title?: string;
          message?: string | null;
          original_path?: string;
          original_sha256?: string;
          page_count?: number;
          signed_path?: string | null;
          signed_sha256?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          expires_at?: string;
          finalizing_at?: string | null;
          completed_at?: string | null;
          voided_at?: string | null;
        };
        Relationships: [];
      };
      signature_signers: {
        Row: {
          id: string;
          org_id: string;
          request_id: string;
          name: string;
          email: string;
          tenant_id: string | null;
          locale: string;
          position: number;
          page: number;
          x: number;
          y: number;
          w: number;
          h: number;
          token_hash: string;
          token_expires_at: string;
          emailed_at: string | null;
          viewed_at: string | null;
          signed_at: string | null;
          ip: string | null;
          user_agent: string | null;
          signature_kind: string | null;
          signature_data: string | null;
          consent_at: string | null;
          consent_version: string | null;
          created_at: string;
          required: boolean;
          declined_at: string | null;
          decline_reason: string | null;
          consent_locale: string | null;
          consent_text_sha256: string | null;
        };
        Insert: {
          id?: string;
          org_id?: string;
          request_id: string;
          name: string;
          email: string;
          tenant_id?: string | null;
          locale?: string;
          position?: number;
          page: number;
          x: number;
          y: number;
          w: number;
          h: number;
          token_hash: string;
          token_expires_at: string;
          emailed_at?: string | null;
          viewed_at?: string | null;
          signed_at?: string | null;
          ip?: string | null;
          user_agent?: string | null;
          signature_kind?: string | null;
          signature_data?: string | null;
          consent_at?: string | null;
          consent_version?: string | null;
          created_at?: string;
          required?: boolean;
          declined_at?: string | null;
          decline_reason?: string | null;
          consent_locale?: string | null;
          consent_text_sha256?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          request_id?: string;
          name?: string;
          email?: string;
          tenant_id?: string | null;
          locale?: string;
          position?: number;
          page?: number;
          x?: number;
          y?: number;
          w?: number;
          h?: number;
          token_hash?: string;
          token_expires_at?: string;
          emailed_at?: string | null;
          viewed_at?: string | null;
          signed_at?: string | null;
          ip?: string | null;
          user_agent?: string | null;
          signature_kind?: string | null;
          signature_data?: string | null;
          consent_at?: string | null;
          consent_version?: string | null;
          created_at?: string;
          required?: boolean;
          declined_at?: string | null;
          decline_reason?: string | null;
          consent_locale?: string | null;
          consent_text_sha256?: string | null;
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      unit_turnover_checklist: {
        Row: {
          id: string;
          unit_id: string;
          lease_id: string;
          item: string;
          item_key: string;
          position: number;
          completed: boolean;
          completed_at: string | null;
          completed_by: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          lease_id: string;
          item: string;
          item_key: string;
          position?: number;
          completed?: boolean;
          completed_at?: string | null;
          completed_by?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          lease_id?: string;
          item?: string;
          item_key?: string;
          position?: number;
          completed?: boolean;
          completed_at?: string | null;
          completed_by?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      units: {
        Row: {
          id: string;
          property_id: string;
          unit_number: string;
          floor: number | null;
          bedrooms: number | null;
          bathrooms: number | null;
          sqm: number | null;
          base_rent: number;
          status: Database["public"]["Enums"]["unit_status"];
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          unit_number: string;
          floor?: number | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
          sqm?: number | null;
          base_rent?: number;
          status?: Database["public"]["Enums"]["unit_status"];
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          unit_number?: string;
          floor?: number | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
          sqm?: number | null;
          base_rent?: number;
          status?: Database["public"]["Enums"]["unit_status"];
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      utility_charges: {
        Row: {
          id: string;
          unit_id: string;
          lease_id: string | null;
          type: Database["public"]["Enums"]["utility_type"];
          period_month: string;
          amount: number;
          status: Database["public"]["Enums"]["utility_status"];
          invoice_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          lease_id?: string | null;
          type?: Database["public"]["Enums"]["utility_type"];
          period_month: string;
          amount?: number;
          status?: Database["public"]["Enums"]["utility_status"];
          invoice_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          lease_id?: string | null;
          type?: Database["public"]["Enums"]["utility_type"];
          period_month?: string;
          amount?: number;
          status?: Database["public"]["Enums"]["utility_status"];
          invoice_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      work_order_notes: {
        Row: {
          id: string;
          work_order_id: string;
          author_id: string | null;
          body: string;
          is_internal: boolean;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          work_order_id: string;
          author_id?: string | null;
          body: string;
          is_internal?: boolean;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          work_order_id?: string;
          author_id?: string | null;
          body?: string;
          is_internal?: boolean;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      work_order_photos: {
        Row: {
          id: string;
          work_order_id: string;
          url: string;
          uploaded_by: string | null;
          created_at: string;
          updated_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          work_order_id: string;
          url: string;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          work_order_id?: string;
          url?: string;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
      work_orders: {
        Row: {
          id: string;
          unit_id: string;
          lease_id: string | null;
          reported_by_tenant: string | null;
          source: Database["public"]["Enums"]["wo_source"];
          category: Database["public"]["Enums"]["wo_category"];
          priority: Database["public"]["Enums"]["wo_priority"];
          folio: string | null;
          title: string;
          description: string | null;
          status: Database["public"]["Enums"]["wo_status"];
          vendor_name: string | null;
          vendor_phone: string | null;
          cost: number | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string | null;
          affects_health_safety: boolean;
          written_notice_at: string | null;
          org_id: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          lease_id?: string | null;
          reported_by_tenant?: string | null;
          source?: Database["public"]["Enums"]["wo_source"];
          category?: Database["public"]["Enums"]["wo_category"];
          priority?: Database["public"]["Enums"]["wo_priority"];
          folio?: string | null;
          title: string;
          description?: string | null;
          status?: Database["public"]["Enums"]["wo_status"];
          vendor_name?: string | null;
          vendor_phone?: string | null;
          cost?: number | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          affects_health_safety?: boolean;
          written_notice_at?: string | null;
          org_id?: string;
        };
        Update: {
          id?: string;
          unit_id?: string;
          lease_id?: string | null;
          reported_by_tenant?: string | null;
          source?: Database["public"]["Enums"]["wo_source"];
          category?: Database["public"]["Enums"]["wo_category"];
          priority?: Database["public"]["Enums"]["wo_priority"];
          folio?: string | null;
          title?: string;
          description?: string | null;
          status?: Database["public"]["Enums"]["wo_status"];
          vendor_name?: string | null;
          vendor_phone?: string | null;
          cost?: number | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
          affects_health_safety?: boolean;
          written_notice_at?: string | null;
          org_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      deposit_obligations: {
        Row: {
          lease_id: string | null;
          unit_id: string | null;
          deposit_amount: number | null;
          surrender_date: string | null;
          forwarding_address: string | null;
          forwarding_address_received_at: string | null;
          deposit_due_date: string | null;
          deposit_settled_at: string | null;
          deposit_itemization: Json | null;
          days_remaining: number | null;
          days_taken: number | null;
          settled_on_time: boolean | null;
        };
        Relationships: [];
      };
      invoice_balances: {
        Row: {
          invoice_id: string | null;
          lease_id: string | null;
          total: number | null;
          paid: number | null;
          balance: number | null;
        };
        Relationships: [];
      };
      lease_balances: {
        Row: {
          lease_id: string | null;
          total_invoiced: number | null;
          total_paid: number | null;
          balance: number | null;
          oldest_overdue_date: string | null;
        };
        Relationships: [];
      };
      my_lease_details: {
        Row: {
          lease_id: string | null;
          unit_id: string | null;
          unit_number: string | null;
          floor: number | null;
          bedrooms: number | null;
          bathrooms: number | null;
          sqm: number | null;
          property_name: string | null;
          street: string | null;
          address_line_2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
        };
        Relationships: [];
      };
      public_settings: {
        Row: {
          company_name: string | null;
          logo_url: string | null;
          invoice_prefix: string | null;
          street: string | null;
          address_line_2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          phone: string | null;
          email: string | null;
          zelle_handle: string | null;
          check_payable_to: string | null;
          check_mailing_address: string | null;
          dropoff_address: string | null;
          office_hours: string | null;
          payment_notes: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      my_tenant_id: { Args: Record<string, never>; Returns: string };
      my_lease_ids: { Args: Record<string, never>; Returns: string[] };
      next_invoice_number: { Args: Record<string, never>; Returns: string };
      today_el_paso: { Args: Record<string, never>; Returns: string };
      confirm_payment: {
        Args: { p_payment: string };
        Returns: { allocations: number; applied: number; credit: number };
      };
      record_payment: {
        Args: {
          p_lease: string;
          p_amount: number;
          p_paid_at: string;
          p_method: Database["public"]["Enums"]["payment_method"];
          p_reference?: string | null;
          p_notes?: string | null;
          p_receipt_url?: string | null;
          p_allocations?: { invoice_id: string; amount: number }[] | null;
        };
        Returns: { payment_id: string; allocations: number; applied: number; credit: number };
      };
      void_payment: {
        Args: { p_payment: string; p_reason: string };
        Returns: { allocations: number; amount: number };
      };
      create_lease: {
        Args: {
          p_unit: string;
          p_terms: {
            start_date: string;
            end_date: string;
            rent_amount: number;
            rent_due_day: number;
            grace_days: number;
            late_fee_type: Database["public"]["Enums"]["late_fee_type"];
            late_fee_percent: number;
            late_fee_amount: number;
            late_fee_over_cap_ack: boolean;
            deposit_amount: number;
            status?: "activo" | "borrador";
          };
          p_primary: string;
          p_co_tenants?: string[];
          p_guarantors?: string[];
          p_checklist?: { item: string; item_key: string; position: number }[];
        };
        Returns: string;
      };
      activate_lease: { Args: { p_lease: string }; Returns: undefined };
      claim_signature_finalisation: { Args: { p_request: string }; Returns: boolean };
      send_signature_request: {
        Args: {
          p_id: string;
          p_lease: string;
          p_title: string;
          p_message: string | null;
          p_sha: string;
          p_page_count: number;
          p_expires_at: string;
          p_signers: Json;
        };
        Returns: string;
      };
      resend_signature_link: {
        Args: { p_signer: string; p_token_hash: string; p_expires_at: string };
        Returns: boolean;
      };
      mark_signature_emailed: { Args: { p_signer: string }; Returns: undefined };
      cancel_signature_request: { Args: { p_request: string }; Returns: string | null };
      record_signature_consent: {
        Args: { p_signer: string; p_version: string; p_locale: string; p_text_sha: string };
        Returns: boolean;
      };
      sign_signature: {
        Args: {
          p_signer: string;
          p_kind: string;
          p_data: string;
          p_ip: string | null;
          p_user_agent: string | null;
        };
        Returns: boolean;
      };
      decline_signature: { Args: { p_signer: string; p_reason: string | null }; Returns: boolean };
      complete_signature_request: {
        Args: {
          p_request: string;
          p_signed_path: string;
          p_signed_sha: string;
          p_name: string;
          p_tenant_paths: Json;
        };
        Returns: undefined;
      };
      approve_application: {
        Args: {
          p_application: string;
          p_terms: Database["public"]["Functions"]["create_lease"]["Args"]["p_terms"];
          p_unit?: string | null;
          p_note?: string | null;
          p_checklist?: { item: string; item_key: string; position: number }[];
        };
        Returns: { tenant_id: string; lease_id: string };
      };
      generate_invoices: {
        Args: { p_period: string };
        Returns: { created: number; skipped: number }[];
      };
      nightly: { Args: { p_org_id: string }; Returns: Json };
      queue_rent_reminders: { Args: { p_org_id: string }; Returns: number };
      claim_notifications: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: {
          id: string;
          org_id: string;
          kind: string;
          payload: Json;
          tenant_name: string | null;
          tenant_email: string | null;
          locale: string;
          company_name: string;
          unit_number: string | null;
        }[];
      };
      notification_result: { Args: { p_id: string; p_channel: string | null }; Returns: undefined };
      late_fee_warnings_to_send: {
        Args: { p_org_id: string };
        Returns: {
          invoice_id: string;
          org_id: string;
          eligible_on: string;
          period_month: string;
          fee: number;
          balance: number;
          unit_number: string;
          tenant_name: string | null;
          tenant_email: string | null;
          locale: string;
          company_name: string;
        }[];
      };
    };
    Enums: {
      access_request_status: "pending" | "approved" | "declined";
      invoice_status:
        "borrador" | "enviado" | "pagado_parcial" | "pagado" | "vencido" | "cancelado";
      late_fee_type: "fixed" | "percent";
      lease_status: "borrador" | "activo" | "por_vencer" | "terminado" | "rescindido";
      lease_tenant_role: "primary" | "co_tenant" | "guarantor";
      line_category:
        | "renta"
        | "estacionamiento"
        | "servicios"
        | "cuota_mantenimiento"
        | "recargo"
        | "otro"
        | "nsf_fee";
      notice_delivery: "in_person" | "mail" | "affixed_to_door";
      notice_type: "non_payment" | "lease_violation" | "end_of_term";
      payment_method: "ach" | "zelle" | "check" | "money_order" | "cash" | "card" | "other";
      payment_status: "pendiente" | "confirmado" | "cancelado";
      unit_status: "vacante" | "ocupada" | "mantenimiento" | "reservada";
      user_role: "admin" | "manager" | "tenant" | "super_admin" | "applicant";
      utility_status: "pendiente" | "facturado";
      utility_type: "agua" | "luz" | "gas" | "cuota_mantenimiento" | "otro";
      wo_category:
        "plomeria" | "electricidad" | "cerrajeria" | "electrodomesticos" | "limpieza" | "otro";
      wo_priority: "baja" | "media" | "alta" | "urgente";
      wo_source: "portal" | "whatsapp" | "telefono" | "personal";
      wo_status:
        "nueva" | "asignada" | "en_progreso" | "esperando_refacciones" | "resuelta" | "cerrada";
    };
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
