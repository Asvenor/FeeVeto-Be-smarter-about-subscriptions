import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";

// Execute production SQL with real SQLite constraints instead of matching query strings.
export async function testDatabase({ billing = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    await readFile(
      new URL("../../migrations/0002_saved_audits.sql", import.meta.url),
      "utf8",
    ),
  );
  if (billing) {
    for (const file of ["0001_billing.sql", "0003_refund_ordering.sql", "0004_monthly_lifetime_billing.sql"])
      sqlite.exec(
        await readFile(
          new URL(`../../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
  }
  const prepare = (sql, bindings = []) => ({
    bind(...values) {
      return prepare(sql, values);
    },
    async first() {
      return sqlite.prepare(sql).get(...bindings) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...bindings) };
    },
    async run() {
      return sqlite.prepare(sql).run(...bindings);
    },
  });
  return {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => sqlite.close(),
  };
}
