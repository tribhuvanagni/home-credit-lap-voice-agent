// HTTP server wiring.

import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config, validateConfig } from "./config.js";
import { logger } from "./logger.js";
import { router as callsRouter } from "./routes/calls.js";
import { router as metaRouter } from "./routes/meta.js";
import { router as webhooksRouter } from "./routes/webhooks.js";

validateConfig();

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(
  express.json({
    limit: "256kb",
    // Keep the untouched bytes for webhook signature verification.
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);

app.use("/api/calls", callsRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api", metaRouter);

// The frontend is a static bundle with no build step, served from the same origin so
// there is no CORS or proxy configuration for a reviewer to get wrong.
const frontendDir = path.join(here, "../../frontend");
if (fs.existsSync(path.join(frontendDir, "index.html"))) {
  app.use(express.static(frontendDir));
}

app.use("/api", (req, res) => {
  res.status(404).json({ error: "route_not_found", path: req.originalUrl });
});

// Single error handler so every failure returns the same shape.
app.use((error, req, res, _next) => {
  logger.error("unhandled request error", {
    method: req.method,
    path: req.originalUrl,
    message: error?.message,
  });
  if (res.headersSent) return;
  res.status(error?.status ?? 500).json({
    error: "internal_error",
    message: config.nodeEnv === "production" ? "An unexpected error occurred." : error?.message,
  });
});

if (config.nodeEnv !== "test") {
  app.listen(config.port, () => {
    logger.info("workbench api listening", {
      url: `http://localhost:${config.port}`,
      llm: config.llm.enabled ? config.llm.model : "rules-only",
    });
  });
}

export default app;
