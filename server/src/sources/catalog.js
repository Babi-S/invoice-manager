// Read-only adapters over the EXISTING customer and service collections.
//
// The schemas of those collections are not assumed: field names are detected
// from the actual documents (or overridden via env vars), and only fields that
// really exist are returned. These adapters only ever call find/count — they
// never insert, update or delete source records.

import mongoose from 'mongoose';
import { escapeRegex, isObjectId } from '../utils/validate.js';

const SENSITIVE = /pass(word)?|secret|token|hash|salt|otp|apikey|api_key/i;
const DETECT_TTL_MS = 60_000;

const CUSTOMER_CANDIDATES = {
  name: ['name', 'fullName', 'full_name', 'customerName', 'customer_name', 'clientName', 'companyName', 'company', 'displayName'],
  firstName: ['firstName', 'first_name', 'fname', 'givenName'],
  lastName: ['lastName', 'last_name', 'lname', 'surname', 'familyName'],
  email: ['email', 'contactEmail', 'emailAddress', 'email_address', 'mail'],
  phone: ['phone', 'phoneNumber', 'phone_number', 'mobile', 'mobileNumber', 'contactNumber', 'contact', 'tel', 'telephone'],
  address: ['address', 'billingAddress', 'fullAddress', 'location', 'street'],
};

const SERVICE_CANDIDATES = {
  name: ['name', 'serviceName', 'service_name', 'title', 'label'],
  description: ['description', 'desc', 'details', 'summary'],
  price: ['price', 'unitPrice', 'unit_price', 'rate', 'amount', 'cost', 'fee', 'monthlyPrice', 'monthly_price'],
};

const getPath = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);

function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    if (value._bsontype === 'Decimal128') return value.toString();
    return Object.entries(value)
      .filter(([k]) => !SENSITIVE.test(k) && k !== '_id')
      .map(([, v]) => toText(v))
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function toPrice(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'object' && value._bsontype === 'Decimal128' ? Number(value.toString()) : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function envOverrides(prefix, logicalFields) {
  const out = {};
  for (const f of logicalFields) {
    const v = process.env[`${prefix}_FIELD_${f.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`];
    if (v) out[f] = v.trim();
  }
  return out;
}

function createSource({ kind, collectionName, candidates, envPrefix, normalize, searchFields }) {
  let cache = null;
  const db = () => mongoose.connection.db;
  const overrides = envOverrides(envPrefix, Object.keys(candidates));

  async function describe({ fresh = false } = {}) {
    if (!fresh && cache && Date.now() - cache.at < DETECT_TTL_MS) return cache.value;

    const exists = (await db().listCollections({ name: collectionName }, { nameOnly: true }).toArray()).length > 0;
    const keys = new Set();
    let count = 0;
    if (exists) {
      const coll = db().collection(collectionName);
      count = await coll.estimatedDocumentCount();
      const sample = await coll.find({}, { limit: 200 }).toArray();
      for (const doc of sample) Object.keys(doc).forEach((k) => keys.add(k));
    }

    const lower = new Map([...keys].map((k) => [k.toLowerCase(), k]));
    const fields = {};
    for (const [logical, list] of Object.entries(candidates)) {
      fields[logical] = overrides[logical] || list.map((c) => lower.get(c.toLowerCase())).find(Boolean) || null;
    }

    const value = {
      kind,
      database: db().databaseName,
      collection: collectionName,
      exists,
      count,
      fields,
      availableFields: [...keys].filter((k) => !SENSITIVE.test(k) && k !== '__v'),
    };
    cache = { at: Date.now(), value };
    return value;
  }

  function present(doc, fields) {
    const mapped = new Set(Object.values(fields).filter(Boolean).map((p) => p.split('.')[0]));
    const extra = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === '_id' || k === '__v' || SENSITIVE.test(k) || mapped.has(k)) continue;
      const text = toText(v);
      if (text) extra[k] = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    }
    return { _id: String(doc._id), ...normalize(doc, fields), extra };
  }

  async function list({ q = '', page = 1, limit = 25 } = {}) {
    const meta = await describe();
    if (!meta.exists) return { items: [], total: 0, page: 1, pages: 0, source: meta };

    const filter = {};
    const term = String(q).trim().slice(0, 100);
    if (term) {
      const paths = searchFields.map((f) => meta.fields[f]).filter(Boolean);
      if (!paths.length) return { items: [], total: 0, page: 1, pages: 0, source: meta };
      const rx = new RegExp(escapeRegex(term), 'i');
      filter.$or = paths.map((p) => ({ [p]: rx }));
    }

    const coll = db().collection(collectionName);
    const sortField = meta.fields.name || meta.fields.firstName || '_id';
    const [total, docs] = await Promise.all([
      coll.countDocuments(filter),
      coll
        .find(filter)
        .sort({ [sortField]: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);
    return {
      items: docs.map((d) => present(d, meta.fields)),
      total,
      page,
      pages: Math.ceil(total / limit),
      source: meta,
    };
  }

  async function findById(id) {
    if (!isObjectId(String(id))) return null;
    const meta = await describe();
    if (!meta.exists) return null;
    const doc = await db().collection(collectionName).findOne({ _id: new mongoose.Types.ObjectId(String(id)) });
    return doc ? present(doc, meta.fields) : null;
  }

  return { describe, list, findById };
}

export const customersSource = createSource({
  kind: 'customer',
  collectionName: process.env.CUSTOMER_COLLECTION || 'customers',
  candidates: CUSTOMER_CANDIDATES,
  envPrefix: 'CUSTOMER',
  searchFields: ['name', 'firstName', 'lastName', 'email'],
  normalize(doc, f) {
    const full = f.name ? toText(getPath(doc, f.name)) : '';
    const parts = [f.firstName, f.lastName].filter(Boolean).map((p) => toText(getPath(doc, p)));
    return {
      name: full || parts.filter(Boolean).join(' ') || '(unnamed)',
      email: f.email ? toText(getPath(doc, f.email)) : undefined,
      phone: f.phone ? toText(getPath(doc, f.phone)) : undefined,
      address: f.address ? toText(getPath(doc, f.address)) : undefined,
    };
  },
});

export const servicesSource = createSource({
  kind: 'service',
  collectionName: process.env.SERVICE_COLLECTION || 'services',
  candidates: SERVICE_CANDIDATES,
  envPrefix: 'SERVICE',
  searchFields: ['name', 'description'],
  normalize(doc, f) {
    return {
      name: (f.name && toText(getPath(doc, f.name))) || '(unnamed)',
      description: f.description ? toText(getPath(doc, f.description)) : undefined,
      price: f.price ? toPrice(getPath(doc, f.price)) : undefined,
    };
  },
});
