// Read-only endpoints over the existing customer and service collections.
import { Router } from 'express';
import { customersSource, servicesSource } from '../sources/catalog.js';
import { notFound } from '../utils/errors.js';
import { parseObjectId } from '../utils/validate.js';

function listParams(query) {
  const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 100000);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const q = typeof query.q === 'string' ? query.q : '';
  return { q, page, limit };
}

function sourceRouter(source, label) {
  const r = Router();
  r.get('/', async (req, res) => res.json(await source.list(listParams(req.query))));
  r.get('/:id', async (req, res) => {
    const item = await source.findById(parseObjectId(req.params.id, `${label} id`).toString());
    if (!item) throw notFound(`${label} not found`);
    res.json(item);
  });
  return r;
}

export const customersRouter = sourceRouter(customersSource, 'Customer');
export const servicesRouter = sourceRouter(servicesSource, 'Service');

export const catalogRouter = Router();
// Re-reads both collections (fresh field detection + counts) — used by "Import Customers & Services".
catalogRouter.get('/status', async (_req, res) => {
  const [customers, services] = await Promise.all([
    customersSource.describe({ fresh: true }),
    servicesSource.describe({ fresh: true }),
  ]);
  res.json({ customers, services });
});
