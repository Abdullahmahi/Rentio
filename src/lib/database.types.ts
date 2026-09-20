// Generated from the Rentio schema — do not edit by hand.
// Regenerate after a migration:  bun run db:types

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
        };
        Insert: {
          id?: string;
          lease_id: string;
          tenant_id: string;
          role?: Database["public"]["Enums"]["lease_tenant_role"];
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          lease_id?: string;
          tenant_id?: string;
          role?: Database["public"]["Enums"]["lease_tenant_role"];
          created_at?: string;
          updated_at?: string | null;
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
        };
        Insert: {
          id?: string;
          payment_id: string;
          invoice_id: string;
          amount: number;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          payment_id?: string;
          invoice_id?: string;
          amount?: number;
          created_at?: string;
          updated_at?: string | null;
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
        };
        Insert: {
          id: string;
          full_name?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          locale?: string | null;
          tenant_id?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string | null;
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
        };
        Relationships: [];
      };
      settings: {
        Row: {
          id: string;
          singleton: boolean;
          company_name: string;
          logo_url: string | null;
          bank_name: string | null;
          clabe: string | null;
          account_holder: string | null;
          invoice_prefix: string;
          default_late_fee: number;
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
        };
        Insert: {
          id?: string;
          singleton?: boolean;
          company_name?: string;
          logo_url?: string | null;
          bank_name?: string | null;
          clabe?: string | null;
          account_holder?: string | null;
          invoice_prefix?: string;
          default_late_fee?: number;
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
        };
        Update: {
          id?: string;
          singleton?: boolean;
          company_name?: string;
          logo_url?: string | null;
          bank_name?: string | null;
          clabe?: string | null;
          account_holder?: string | null;
          invoice_prefix?: string;
          default_late_fee?: number;
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
        };
        Insert: {
          id?: string;
          work_order_id: string;
          author_id?: string | null;
          body: string;
          is_internal?: boolean;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          work_order_id?: string;
          author_id?: string | null;
          body?: string;
          is_internal?: boolean;
          created_at?: string;
          updated_at?: string | null;
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
        };
        Insert: {
          id?: string;
          work_order_id: string;
          url: string;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          work_order_id?: string;
          url?: string;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string | null;
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
        };
        Relationships: [];
      };
    };
    Views: {
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
          bank_name: string | null;
          clabe: string | null;
          account_holder: string | null;
          invoice_prefix: string | null;
          street: string | null;
          address_line_2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          phone: string | null;
          email: string | null;
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
    };
    Enums: {
      invoice_status:
        "borrador" | "enviado" | "pagado_parcial" | "pagado" | "vencido" | "cancelado";
      lease_status: "borrador" | "activo" | "por_vencer" | "terminado" | "rescindido";
      lease_tenant_role: "primary" | "co_tenant" | "guarantor";
      line_category:
        "renta" | "estacionamiento" | "servicios" | "cuota_mantenimiento" | "recargo" | "otro";
      payment_method: "spei" | "efectivo" | "deposito" | "oxxo" | "cheque" | "tarjeta";
      payment_status: "pendiente" | "confirmado" | "cancelado";
      unit_status: "vacante" | "ocupada" | "mantenimiento" | "reservada";
      user_role: "admin" | "manager" | "tenant";
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
