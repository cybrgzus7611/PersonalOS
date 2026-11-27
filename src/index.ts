/// <reference types="@cloudflare/workers-types" />
import { createApp } from "./api/app.ts";
import { D1Db } from "./platform/cloudflare.ts";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT?: string;
}

const app = createApp({
  getDb: (c) => new D1Db((c.env as Env).DB),
  isDev: (c) => (c.env as Env).ENVIRONMENT === "development",
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
