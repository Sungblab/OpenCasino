import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  // Without a timeout, a starved pool waits forever and the whole API goes quiet with the
  // database sitting idle — no error, no log, nothing to page on. Ten seconds is far longer than
  // any query here, so hitting it means the pool is exhausted, and failing that request loudly
  // beats hanging every request behind it.
  connectionTimeoutMillis: 10_000,
});

