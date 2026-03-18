import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./routes/api-routes.js";
import { createWebhookRouter } from "./routes/webhook-routes.js";
import { fail } from "./lib/json-response.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export function createApp(services) {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(projectRoot));

  app.use("/api", createApiRouter(services));
  app.use("/webhooks", createWebhookRouter(services));

  app.use((req, res) => {
    fail(res, "Not found.", 404);
  });

  return app;
}
