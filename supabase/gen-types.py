#!/usr/bin/env python3
"""Emit Supabase-shaped Database types from the live catalog.

The supabase CLI needs Docker for `gen types`; this reads pg_catalog directly.
"""
import collections, os, subprocess, sys

DSN = os.environ.get("DATABASE_URL", "postgresql://postgres@127.0.0.1:55432/rentio")
SEP = "\x1f"


def q(sql):
    out = subprocess.run(
        ["psql", DSN, "-tAF", SEP, "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line.split(SEP) for line in out.strip().split("\n") if line.strip()]


SCALARS = {
    "uuid": "string", "text": "string", "varchar": "string", "bpchar": "string",
    "numeric": "number", "int2": "number", "int4": "number", "int8": "number",
    "float4": "number", "float8": "number",
    "bool": "boolean",
    "date": "string", "timestamptz": "string", "timestamp": "string", "time": "string",
    "jsonb": "Json", "json": "Json",
}

enums = collections.OrderedDict()
for name, label in q("""
    select t.typname, e.enumlabel
    from pg_type t join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    order by t.typname, e.enumsortorder
"""):
    enums.setdefault(name, []).append(label)


def ts(udt, nullable):
    base = SCALARS.get(udt)
    if base is None:
        base = f'Database["public"]["Enums"]["{udt}"]' if udt in enums else "unknown"
    return base + (" | null" if nullable else "")


rows = q("""
    select c.relname,
           c.relkind,
           a.attname,
           format_type(a.atttypid, null),
           t.typname,
           not a.attnotnull as nullable,
           (a.atthasdef or a.attidentity <> '') as has_default
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_type t on t.oid = a.atttypid
    where n.nspname = 'public' and c.relkind in ('r', 'v')
    order by c.relkind desc, c.relname, a.attnum
""")

tables, views = collections.OrderedDict(), collections.OrderedDict()
for relname, relkind, col, _fmt, udt, nullable, has_default in rows:
    target = tables if relkind == "r" else views
    target.setdefault(relname, []).append(
        (col, udt, nullable == "t", has_default == "t")
    )

out = [
    "// Generated from the Rentio schema — do not edit by hand.",
    "// Regenerate after a migration:  bun run db:types",
    "",
    "export type Json =",
    "  | string",
    "  | number",
    "  | boolean",
    "  | null",
    "  | { [key: string]: Json | undefined }",
    "  | Json[];",
    "",
    "export type Database = {",
    "  public: {",
    "    Tables: {",
]

for name, cols in tables.items():
    out.append(f"      {name}: {{")
    out.append("        Row: {")
    for col, udt, nullable, _ in cols:
        out.append(f"          {col}: {ts(udt, nullable)};")
    out.append("        };")
    out.append("        Insert: {")
    for col, udt, nullable, has_default in cols:
        opt = "?" if (nullable or has_default) else ""
        out.append(f"          {col}{opt}: {ts(udt, nullable)};")
    out.append("        };")
    out.append("        Update: {")
    for col, udt, nullable, _ in cols:
        out.append(f"          {col}?: {ts(udt, nullable)};")
    out.append("        };")
    out.append("        Relationships: [];")
    out.append("      };")

out.append("    };")
out.append("    Views: {")
for name, cols in views.items():
    out.append(f"      {name}: {{")
    out.append("        Row: {")
    for col, udt, nullable, _ in cols:
        out.append(f"          {col}: {ts(udt, nullable)};")
    out.append("        };")
    out.append("        Relationships: [];")
    out.append("      };")
out.append("    };")

out.append("    Functions: {")
out.append("      is_staff: { Args: Record<string, never>; Returns: boolean };")
out.append("      is_admin: { Args: Record<string, never>; Returns: boolean };")
out.append("      my_tenant_id: { Args: Record<string, never>; Returns: string };")
out.append("      my_lease_ids: { Args: Record<string, never>; Returns: string[] };")
out.append("      next_invoice_number: { Args: Record<string, never>; Returns: string };")
out.append("    };")

out.append("    Enums: {")
for name, labels in enums.items():
    union = " | ".join(f'"{l}"' for l in labels)
    out.append(f"      {name}: {union};")
out.append("    };")
out.append("    CompositeTypes: Record<string, never>;")
out.append("  };")
out.append("};")
out.append("")

# Convenience aliases — every module imports from here.
out.append("type PublicSchema = Database[\"public\"];")
out.append("export type Tables<T extends keyof PublicSchema[\"Tables\"]> =")
out.append("  PublicSchema[\"Tables\"][T][\"Row\"];")
out.append("export type TablesInsert<T extends keyof PublicSchema[\"Tables\"]> =")
out.append("  PublicSchema[\"Tables\"][T][\"Insert\"];")
out.append("export type TablesUpdate<T extends keyof PublicSchema[\"Tables\"]> =")
out.append("  PublicSchema[\"Tables\"][T][\"Update\"];")
out.append("export type Views<T extends keyof PublicSchema[\"Views\"]> =")
out.append("  PublicSchema[\"Views\"][T][\"Row\"];")
out.append("export type Enums<T extends keyof PublicSchema[\"Enums\"]> =")
out.append("  PublicSchema[\"Enums\"][T];")
out.append("")

sys.stdout.write("\n".join(out))
