/**
 * The importer runs against a client's real spreadsheet, twice, and must not
 * duplicate anything the second time. These pin down the parsing and the
 * per-row verdicts the preview shows.
 */
import { expect, test } from "bun:test";
import {
  IMPORT_SCHEMAS, autoMapColumns, parseDate, parseMoney, summarize, validateRows,
  type ValidationContext,
} from "@/lib/import";
import { parseCsv, toCsv } from "@/lib/csv";

const context = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  propertyNames: new Set(["edificio roma 214"]),
  unitKeys: new Set(["edificio roma 214|101"]),
  tenantEmails: new Set(["maria.rios@example.mx"]),
  tenantPhones: new Set(["+52 55 1234 5678"]),
  leaseKeys: new Set(),
  ...over,
});

test("parseDate reads dd/mm/aaaa first, then ISO", () => {
  expect(parseDate("01/03/2026")).toBe("2026-03-01");   // 1 March, not 3 January
  expect(parseDate("31/12/2026")).toBe("2026-12-31");
  expect(parseDate("1-3-2026")).toBe("2026-03-01");
  expect(parseDate("2026-03-01")).toBe("2026-03-01");
  expect(parseDate("March 1 2026")).toBeNull();
  expect(parseDate("")).toBeNull();
});

test("parseMoney handles $ , and the comma decimal separator", () => {
  expect(parseMoney("15000")).toBe(15000);
  expect(parseMoney("$15,000.00")).toBe(15000);
  expect(parseMoney("$ 15 000")).toBe(15000);
  expect(parseMoney("15000,50")).toBe(15000.5);
  expect(parseMoney("1.234.567,89")).toBe(1234567.89);
  expect(parseMoney("abc")).toBeNull();
});

test("autoMapColumns matches Spanish headers, accents and casing", () => {
  const mapping = autoMapColumns(
    ["Propiedad", "Número", "PISO", "Recámaras", "Baños", "m2", "Renta base", "Sobra"],
    IMPORT_SCHEMAS.units,
  );
  expect(mapping["property"]).toBe(0);
  expect(mapping["unit_number"]).toBe(1);
  expect(mapping["floor"]).toBe(2);
  expect(mapping["bedrooms"]).toBe(3);
  expect(mapping["bathrooms"]).toBe(4);
  expect(mapping["sqm"]).toBe(5);
  expect(mapping["base_rent"]).toBe(6);
});

test("units: flags a missing required field, an unknown property and a bad number", () => {
  const schema = IMPORT_SCHEMAS.units;
  const mapping = autoMapColumns(["property", "unit_number", "base_rent"], schema);
  const rows = validateRows(
    [
      ["Edificio Roma 214", "302", "15000"],   // new -> valid
      ["Edificio Roma 214", "101", "16000"],   // exists -> update warning
      ["Torre Fantasma", "201", "12000"],      // unknown property
      ["Edificio Roma 214", "", "12000"],      // missing unit number
      ["Edificio Roma 214", "303", "mucho"],   // unparseable rent
    ],
    mapping, schema, context(),
  );

  expect(rows.map((row) => row.status)).toEqual(["valid", "warning", "error", "error", "error"]);
  expect(rows[1]?.isUpdate).toBe(true);
  expect(rows[1]?.reason?.key).toBe("import.warnings.willUpdate");
  expect(rows[2]?.reason?.key).toBe("import.errors.unknownProperty");
  expect(rows[3]?.reason?.key).toBe("import.errors.required");
  expect(rows[4]?.reason?.key).toBe("import.errors.notANumber");
  expect(summarize(rows)).toEqual({ valid: 1, warning: 1, error: 3 });
});

test("tenants: an existing email or phone is an update, and one of them is required", () => {
  const schema = IMPORT_SCHEMAS.tenants;
  const mapping = autoMapColumns(["full_name", "email", "phone"], schema);
  const rows = validateRows(
    [
      ["Nuevo Inquilino", "nuevo@example.mx", "+52 55 0000 0000"],
      ["María Fernanda Ríos", "maria.rios@example.mx", ""],   // email exists
      ["Otro Nombre", "", "+52 55 1234 5678"],                // phone exists
      ["Sin Contacto", "", ""],                               // no way to reach them
    ],
    mapping, schema, context(),
  );

  expect(rows.map((row) => row.status)).toEqual(["valid", "warning", "warning", "error"]);
  expect(rows[3]?.reason?.key).toBe("import.errors.contactRequired");
});

test("leases: the unit and tenant must already exist, and dates must run forwards", () => {
  const schema = IMPORT_SCHEMAS.leases;
  const mapping = autoMapColumns(
    ["property", "unit_number", "tenant", "start_date", "end_date", "rent_amount"],
    schema,
  );
  const rows = validateRows(
    [
      ["Edificio Roma 214", "101", "maria.rios@example.mx", "01/01/2026", "31/12/2026", "15000"],
      ["Edificio Roma 214", "999", "maria.rios@example.mx", "01/01/2026", "31/12/2026", "15000"],
      ["Edificio Roma 214", "101", "nadie@example.mx", "01/01/2026", "31/12/2026", "15000"],
      ["Edificio Roma 214", "101", "maria.rios@example.mx", "31/12/2026", "01/01/2026", "15000"],
    ],
    mapping, schema, context(),
  );

  expect(rows[0]?.status).toBe("valid");
  expect(rows[0]?.values["start_date"]).toBe("2026-01-01");
  expect(rows[1]?.reason?.key).toBe("import.errors.unknownUnit");
  expect(rows[2]?.reason?.key).toBe("import.errors.unknownTenant");
  expect(rows[3]?.reason?.key).toBe("import.errors.datesInvalid");
});

test("re-running the same file produces updates, never duplicates", () => {
  const schema = IMPORT_SCHEMAS.units;
  const mapping = autoMapColumns(["property", "unit_number", "base_rent"], schema);
  const file = [["Edificio Roma 214", "302", "15000"]];

  const first = validateRows(file, mapping, schema, context());
  expect(first[0]?.status).toBe("valid");
  expect(first[0]?.isUpdate).toBe(false);

  // Second run, with 302 now present.
  const after = context({ unitKeys: new Set(["edificio roma 214|101", "edificio roma 214|302"]) });
  const second = validateRows(file, mapping, schema, after);
  expect(second[0]?.status).toBe("warning");
  expect(second[0]?.isUpdate).toBe(true);
});

test("CSV round-trips quoted fields, embedded commas and blank lines", () => {
  const csv = toCsv(["a", "b"], [["Roma, Norte", 'dice "hola"'], ["x", "y"]]);
  const parsed = parseCsv(csv + "\r\n\r\n");
  expect(parsed).toEqual([["a", "b"], ["Roma, Norte", 'dice "hola"'], ["x", "y"]]);
});
