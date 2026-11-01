import mongoose from 'mongoose';
import { badRequest } from './errors.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isObjectId = (v) => typeof v === 'string' && OBJECT_ID.test(v);

export function parseObjectId(value, label = 'id') {
  const s = value == null ? '' : String(value);
  if (!isObjectId(s)) throw badRequest(`Invalid ${label}`);
  return new mongoose.Types.ObjectId(s);
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Collects field errors so the client gets every problem in one response. */
export function createValidator() {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });

  return {
    errors,
    fail,

    str(value, path, { required = false, max = 500 } = {}) {
      if (isBlank(value)) {
        if (required) fail(path, 'is required');
        return '';
      }
      if (typeof value !== 'string' && typeof value !== 'number') {
        fail(path, 'must be text');
        return '';
      }
      const s = String(value).trim();
      if (s.length > max) fail(path, `must be at most ${max} characters`);
      return s;
    },

    email(value, path) {
      const s = this.str(value, path, { max: 254 });
      if (s && !EMAIL.test(s)) fail(path, 'must be a valid email address');
      return s;
    },

    num(value, path, { required = true, min = 0, max = 1e9, int = false, positive = false } = {}) {
      if (isBlank(value)) {
        if (required) fail(path, 'is required');
        return undefined;
      }
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      if (!Number.isFinite(n)) {
        fail(path, 'must be a number');
        return undefined;
      }
      if (int && !Number.isInteger(n)) fail(path, 'must be a whole number');
      if (positive ? n <= min : n < min) fail(path, positive ? `must be greater than ${min}` : `must be at least ${min}`);
      if (n > max) fail(path, `must be at most ${max}`);
      return n;
    },

    date(value, path, { required = false } = {}) {
      if (isBlank(value)) {
        if (required) fail(path, 'is required');
        return null;
      }
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        fail(path, 'must be a valid date');
        return null;
      }
      // Normalise to UTC midnight so dates never shift with time zones.
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    },

    oid(value, path) {
      if (isBlank(value)) return null;
      if (!isObjectId(String(value))) {
        fail(path, 'must be a valid MongoDB ObjectId');
        return null;
      }
      return new mongoose.Types.ObjectId(String(value));
    },

    oneOf(value, path, allowed, fallback) {
      if (isBlank(value)) return fallback;
      if (!allowed.includes(value)) {
        fail(path, `must be one of: ${allowed.join(', ')}`);
        return fallback;
      }
      return value;
    },

    array(value, path, { min = 0, max = 100 } = {}) {
      if (!Array.isArray(value)) {
        fail(path, 'must be a list');
        return [];
      }
      if (value.length < min) fail(path, min === 1 ? 'must contain at least one item' : `must contain at least ${min} items`);
      if (value.length > max) fail(path, `must contain at most ${max} items`);
      return value.slice(0, max);
    },

    throwIfErrors(message = 'Validation failed') {
      if (errors.length) throw badRequest(message, errors);
    },
  };
}
