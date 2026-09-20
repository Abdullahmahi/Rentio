/**
 * CSV import: schemas, auto-mapping and row validation.
 *
 * All of this is pure so the validation preview can be trusted before a single
 * row is written. Re-running an import must be safe, so every schema declares
 * a natural key; a row matching an existing record is an UPDATE, flagged as a
 * warning in the preview rather than silently creating a duplicate.
 */

export type ImportKind = "units" | "tenants" | "leases";
export type RowStatus = "valid" | "warning" | "error";

export interface ImportField {
  key: string;
  /** i18n key for the human label. */
  label: string;
  required: boolean;
  /** Header names this field auto-matches, lowercased and accent-stripped. */
  aliases: string[];
  type: "text" | "number" | "integer" | "money" | "date";
  example: string;
}

export interface ImportSchema {
  kind: ImportKind;
  fields: ImportField[];
  /** Fields whose combination identifies an existing record. */
  naturalKey: string[];
}

const normalize = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export const IMPORT_SCHEMAS: Record<ImportKind, ImportSchema> = {
  units: {
    kind: "units",
    naturalKey: ["property", "unit_number"],
    fields: [
      {
        key: "property",
        label: "units.fields.property",
        required: true,
        type: "text",
        aliases: ["propiedad", "property", "edificio", "building"],
        example: "Edificio Roma 214",
      },
      {
        key: "unit_number",
        label: "units.fields.number",
        required: true,
        type: "text",
        aliases: ["unidad", "unit", "numero", "unit_number", "num_unidad"],
        example: "301",
      },
      {
        key: "floor",
        label: "units.fields.floor",
        required: false,
        type: "integer",
        aliases: ["piso", "floor", "nivel"],
        example: "3",
      },
      {
        key: "bedrooms",
        label: "units.fields.bedrooms",
        required: false,
        type: "integer",
        aliases: ["recamaras", "bedrooms", "habitaciones", "cuartos"],
        example: "2",
      },
      {
        key: "bathrooms",
        label: "units.fields.bathrooms",
        required: false,
        type: "number",
        aliases: ["banos", "bathrooms"],
        example: "1.5",
      },
      {
        key: "sqm",
        label: "units.fields.sqm",
        required: false,
        type: "number",
        aliases: ["m2", "metros", "sqm", "superficie"],
        example: "78",
      },
      {
        key: "base_rent",
        label: "units.fields.baseRent",
        required: true,
        type: "money",
        aliases: ["renta", "renta_base", "base_rent", "rent"],
        example: "15000",
      },
    ],
  },
  tenants: {
    kind: "tenants",
    naturalKey: ["email", "phone"],
    fields: [
      {
        key: "full_name",
        label: "tenants.fields.fullName",
        required: true,
        type: "text",
        aliases: ["nombre", "nombre_completo", "full_name", "name", "inquilino"],
        example: "María Fernanda Ríos",
      },
      {
        key: "email",
        label: "tenants.fields.email",
        required: false,
        type: "text",
        aliases: ["correo", "email", "correo_electronico", "e_mail"],
        example: "maria.rios@example.mx",
      },
      {
        key: "phone",
        label: "tenants.fields.phone",
        required: false,
        type: "text",
        aliases: ["telefono", "phone", "celular", "movil", "tel"],
        example: "(915) 555-0123",
      },
      {
        key: "emergency_contact_name",
        label: "tenants.fields.emergencyName",
        required: false,
        type: "text",
        aliases: ["contacto_emergencia", "emergency_contact", "emergency_contact_name"],
        example: "Jorge Ríos",
      },
      {
        key: "emergency_contact_phone",
        label: "tenants.fields.emergencyPhone",
        required: false,
        type: "text",
        aliases: ["telefono_emergencia", "emergency_phone", "emergency_contact_phone"],
        example: "+52 55 8765 4321",
      },
      {
        key: "notes",
        label: "tenants.fields.notes",
        required: false,
        type: "text",
        aliases: ["notas", "notes", "observaciones"],
        example: "",
      },
    ],
  },
  leases: {
    kind: "leases",
    naturalKey: ["property", "unit_number", "start_date"],
    fields: [
      {
        key: "property",
        label: "units.fields.property",
        required: true,
        type: "text",
        aliases: ["propiedad", "property", "edificio"],
        example: "Edificio Roma 214",
      },
      {
        key: "unit_number",
        label: "units.fields.number",
        required: true,
        type: "text",
        aliases: ["unidad", "unit", "numero", "unit_number"],
        example: "301",
      },
      {
        key: "tenant",
        label: "contracts.fields.primaryTenant",
        required: true,
        type: "text",
        aliases: ["inquilino", "tenant", "correo_inquilino", "tenant_email", "nombre_inquilino"],
        example: "maria.rios@example.mx",
      },
      {
        key: "start_date",
        label: "contracts.fields.startDate",
        required: true,
        type: "date",
        aliases: ["inicio", "fecha_inicio", "start", "start_date"],
        example: "01/01/2026",
      },
      {
        key: "end_date",
        label: "contracts.fields.endDate",
        required: true,
        type: "date",
        aliases: ["fin", "fecha_fin", "end", "end_date", "vencimiento"],
        example: "31/12/2026",
      },
      {
        key: "rent_amount",
        label: "contracts.fields.rent",
        required: true,
        type: "money",
        aliases: ["renta", "renta_mensual", "rent", "rent_amount"],
        example: "15000",
      },
      {
        key: "rent_due_day",
        label: "contracts.fields.dueDay",
        required: false,
        type: "integer",
        aliases: ["dia_pago", "due_day", "rent_due_day"],
        example: "1",
      },
      {
        key: "deposit_amount",
        label: "contracts.fields.deposit",
        required: false,
        type: "money",
        aliases: ["deposito", "deposit", "deposit_amount", "garantia"],
        example: "15000",
      },
    ],
  },
};

/** Header row plus one example row, for the downloadable template. */
export function templateFor(schema: ImportSchema) {
  return {
    headers: schema.fields.map((field) => field.key),
    example: schema.fields.map((field) => field.example),
  };
}

/** Match file headers to fields by name, so the mapping step starts mostly done. */
export function autoMapColumns(
  headers: string[],
  schema: ImportSchema,
): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  const normalized = headers.map(normalize);

  for (const field of schema.fields) {
    const candidates = [field.key, ...field.aliases].map(normalize);
    const index = normalized.findIndex((header) => candidates.includes(header));
    mapping[field.key] = index === -1 ? null : index;
  }
  return mapping;
}

/**
 * mm/dd/yyyy first — that is what a US spreadsheet holds — then ISO.
 *
 * The order matters: read as dd/mm, `03/04/2026` silently becomes April 3rd
 * instead of March 4th, and a lease start date is off by a month.
 */
export function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (slash) {
    const [, month, day, year] = slash;
    if (Number(month) > 12 || Number(day) > 31) return null;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? null : iso;
  }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? null : iso;
  }
  return null;
}

/** "$1,500.00" and "1500" both mean one thousand five hundred dollars. */
export function parseMoney(raw: string): number | null {
  const value = raw.trim().replace(/[$\s]/g, "");
  if (!value) return null;
  // A comma used as the decimal separator, e.g. "15000,50".
  const normalized = /,\d{1,2}$/.test(value)
    ? value.replace(/\./g, "").replace(",", ".")
    : value.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ValidationContext {
  propertyNames: Set<string>;
  /** "property|unit_number" for every existing unit. */
  unitKeys: Set<string>;
  tenantEmails: Set<string>;
  tenantPhones: Set<string>;
  /** "property|unit_number|start_date" for every existing lease. */
  leaseKeys: Set<string>;
}

export interface ValidatedRow {
  index: number;
  status: RowStatus;
  /** i18n key plus params, so the reason renders in the user's language. */
  reason?: { key: string; params?: Record<string, string | number> };
  values: Record<string, string | number | null>;
  raw: string[];
  /** True when the natural key already exists — this row updates, not inserts. */
  isUpdate: boolean;
}

export function validateRows(
  rows: string[][],
  mapping: Record<string, number | null>,
  schema: ImportSchema,
  context: ValidationContext,
): ValidatedRow[] {
  const keyOf = (values: Record<string, string | number | null>) =>
    schema.naturalKey
      .map((field) =>
        String(values[field] ?? "")
          .trim()
          .toLocaleLowerCase(),
      )
      .join("|");

  return rows.map((raw, index) => {
    const values: Record<string, string | number | null> = {};
    let error: ValidatedRow["reason"] | undefined;

    for (const field of schema.fields) {
      const column = mapping[field.key];
      const cell = column === null || column === undefined ? "" : (raw[column] ?? "").trim();

      if (!cell) {
        if (field.required && !error) {
          error = { key: "import.errors.required", params: { field: field.key } };
        }
        values[field.key] = null;
        continue;
      }

      switch (field.type) {
        case "money": {
          const parsed = parseMoney(cell);
          if (parsed === null) {
            error ??= {
              key: "import.errors.notANumber",
              params: { field: field.key, value: cell },
            };
          }
          values[field.key] = parsed;
          break;
        }
        case "number":
        case "integer": {
          const parsed = Number(cell.replace(/,/g, "."));
          if (!Number.isFinite(parsed)) {
            error ??= {
              key: "import.errors.notANumber",
              params: { field: field.key, value: cell },
            };
            values[field.key] = null;
          } else {
            values[field.key] = field.type === "integer" ? Math.round(parsed) : parsed;
          }
          break;
        }
        case "date": {
          const parsed = parseDate(cell);
          if (parsed === null) {
            error ??= { key: "import.errors.badDate", params: { value: cell } };
          }
          values[field.key] = parsed;
          break;
        }
        default:
          values[field.key] = cell;
      }
    }

    // --------------------------------------------- cross-record checks
    if (!error && (schema.kind === "units" || schema.kind === "leases")) {
      const property = String(values["property"] ?? "");
      if (!context.propertyNames.has(property.trim().toLocaleLowerCase())) {
        error = { key: "import.errors.unknownProperty", params: { value: property } };
      }
    }

    if (!error && schema.kind === "leases") {
      const unitKey = `${String(values["property"] ?? "")
        .trim()
        .toLocaleLowerCase()}|${String(values["unit_number"] ?? "")
        .trim()
        .toLocaleLowerCase()}`;
      if (!context.unitKeys.has(unitKey)) {
        error = {
          key: "import.errors.unknownUnit",
          params: { value: String(values["unit_number"] ?? "") },
        };
      }
      const tenant = String(values["tenant"] ?? "")
        .trim()
        .toLocaleLowerCase();
      if (!error && !context.tenantEmails.has(tenant) && !context.tenantPhones.has(tenant)) {
        error = {
          key: "import.errors.unknownTenant",
          params: { value: String(values["tenant"] ?? "") },
        };
      }
      const start = values["start_date"];
      const end = values["end_date"];
      if (!error && typeof start === "string" && typeof end === "string" && end <= start) {
        error = { key: "import.errors.datesInvalid" };
      }
    }

    if (!error && schema.kind === "tenants" && !values["email"] && !values["phone"]) {
      error = { key: "import.errors.contactRequired" };
    }

    if (error) {
      return { index, status: "error", reason: error, values, raw, isUpdate: false };
    }

    // ------------------------------------------------- duplicate check
    let isUpdate = false;
    if (schema.kind === "units") {
      isUpdate = context.unitKeys.has(keyOf(values));
    } else if (schema.kind === "tenants") {
      const email = String(values["email"] ?? "")
        .trim()
        .toLocaleLowerCase();
      const phone = String(values["phone"] ?? "")
        .trim()
        .toLocaleLowerCase();
      isUpdate =
        (Boolean(email) && context.tenantEmails.has(email)) ||
        (Boolean(phone) && context.tenantPhones.has(phone));
    } else {
      isUpdate = context.leaseKeys.has(keyOf(values));
    }

    return {
      index,
      status: isUpdate ? "warning" : "valid",
      ...(isUpdate ? { reason: { key: "import.warnings.willUpdate" } } : {}),
      values,
      raw,
      isUpdate,
    };
  });
}

export function summarize(rows: ValidatedRow[]) {
  return {
    valid: rows.filter((row) => row.status === "valid").length,
    warning: rows.filter((row) => row.status === "warning").length,
    error: rows.filter((row) => row.status === "error").length,
  };
}
