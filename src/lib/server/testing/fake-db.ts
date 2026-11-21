/**
 * Test-only. An in-memory stand-in for the PostgREST client: enough of
 * from().select/insert/update/delete with eq/is/in/neq filters, plus rpc
 * handlers, to drive server modules without a database or a network.
 * ponytail: filters are equality-only; add operators when a test needs them.
 */
import type { Db } from "@/lib/server/session";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: { code: string; message: string } | null };

export function fakeDb(
  seed: Record<string, Row[]> = {},
  options: {
    unique?: Record<string, string[]>;
    rpc?: Record<string, (args: Row) => Result | Promise<Result>>;
  } = {},
) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
  );
  const rpcCalls: { name: string; args: Row }[] = [];
  const rows = (table: string) => (tables[table] ??= []);

  const query = (table: string, op: string, payload?: Row | Row[]) => {
    const filters: Filter[] = [];
    let returning = op === "select";
    const run = (): Result => {
      const list = rows(table);
      if (op === "insert") {
        const incoming = Array.isArray(payload) ? payload : [payload!];
        for (const row of incoming)
          for (const column of options.unique?.[table] ?? [])
            if (row[column] != null && list.some((other) => other[column] === row[column]))
              return { data: null, error: { code: "23505", message: `duplicate ${column}` } };
        const stored = incoming.map((row) => ({ id: crypto.randomUUID(), ...row }));
        list.push(...stored);
        return { data: returning ? stored.map((row) => ({ ...row })) : null, error: null };
      }
      const hit = list.filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") {
        for (const row of hit) Object.assign(row, payload);
        return { data: returning ? hit : null, error: null };
      }
      if (op === "delete") {
        tables[table] = list.filter((row) => !hit.includes(row));
        return { data: returning ? hit : null, error: null };
      }
      return { data: hit.map((row) => ({ ...row })), error: null };
    };
    const builder = {
      eq: (column: string, value: unknown) => (
        filters.push((row) => row[column] === value),
        builder
      ),
      neq: (column: string, value: unknown) => (
        filters.push((row) => row[column] !== value),
        builder
      ),
      is: (column: string, value: unknown) => (
        filters.push((row) => (row[column] ?? null) === value),
        builder
      ),
      in: (column: string, values: unknown[]) => (
        filters.push((row) => values.includes(row[column])),
        builder
      ),
      select: () => ((returning = true), builder),
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => {
        const result = run();
        const list = (result.data as Row[] | null) ?? [];
        return Promise.resolve({ data: list[0] ?? null, error: result.error });
      },
      then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };

  const db = {
    from: (table: string) => ({
      select: () => query(table, "select"),
      insert: (payload: Row | Row[]) => query(table, "insert", payload),
      update: (payload: Row) => query(table, "update", payload),
      delete: () => query(table, "delete"),
    }),
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      const handler = options.rpc?.[name];
      return handler ? await handler(args) : { data: null, error: null };
    },
  };
  return { db: db as unknown as Db, tables, rows, rpcCalls };
}
