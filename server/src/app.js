import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mongoose from 'mongoose';
import invoicesRouter from './routes/invoices.js';
import dashboardRouter from './routes/dashboard.js';
import settingsRouter from './routes/settings.js';
import { catalogRouter, customersRouter, servicesRouter } from './routes/catalog.js';
import { errorHandler } from './utils/errors.js';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) =>
    res.json({ ok: mongoose.connection.readyState === 1, database: mongoose.connection.db?.databaseName }),
  );
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built frontend (npm run build) with SPA fallback.
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(clientDist, 'index.html')) : next()));
  }

  app.use(errorHandler);
  return app;
}
