import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { buildApp } from "./app.js";
import { PgPetRepository } from "./pg-repository.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://petlink:petlink@127.0.0.1:5432/petlink";
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const pool = new pg.Pool({ connectionString: databaseUrl });

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, process.env.NODE_ENV === "production" ? "../migrations/001_initial.sql" : "../migrations/001_initial.sql");
const migration = await readFile(migrationPath, "utf8");
await pool.query(migration);

const app = await buildApp({ repository: new PgPetRepository(pool), logger: true });
await app.listen({ host, port });

const shutdown = async () => {
  await app.close();
  await pool.end();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
