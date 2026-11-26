import type { D1Migration } from "@cloudflare/vitest-pool-workers";
declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    EXTENSION_ORIGINS: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}
