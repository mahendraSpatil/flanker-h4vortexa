// Owner: Archit (frozen; ask before changing) | Express app: middleware, routers (one file per owner), errors
import cors from 'cors';
import express from 'express';
import { actorMiddleware } from './lib/actor.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import auditRouter from './routes/audit.js';
import batchesRouter from './routes/batches.js';
import demoRouter from './routes/demo.js';
import documentsRouter from './routes/documents.js';
import explainRouter from './routes/explain.js';
import healthRouter from './routes/health.js';
import proofsRouter from './routes/proofs.js';

// Only the registry app may call the API from a browser. The verifier (5174) must never reach it.
const REGISTRY_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function createApp() {
  const app = express();

  app.use(cors({ origin: REGISTRY_ORIGINS }));
  app.use(express.json({ limit: '1mb' }));
  app.use(actorMiddleware);

  // Routers declare full /api/... paths. proofs before documents: both live under /api/documents/:recordId.
  app.use(healthRouter);
  app.use(proofsRouter);
  app.use(documentsRouter);
  app.use(batchesRouter);
  app.use(auditRouter);
  app.use(demoRouter);
  app.use(explainRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
