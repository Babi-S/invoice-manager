import { Router } from 'express';
import { Settings, getSettings } from '../models/Settings.js';
import { createValidator } from '../utils/validate.js';
import { CURRENCIES } from '../../../shared/format.js';

const router = Router();
const MAX_LOGO_CHARS = 700_000; // ~500 KB image as base64

router.get('/', async (_req, res) => res.json(await getSettings()));

router.put('/', async (req, res) => {
  const b = req.body || {};
  const v = createValidator();
  const update = {
    businessName: v.str(b.businessName, 'businessName', { max: 200 }),
    address: v.str(b.address, 'address', { max: 500 }),
    email: v.email(b.email, 'email'),
    phone: v.str(b.phone, 'phone', { max: 50 }),
    currency: v.oneOf(b.currency, 'currency', CURRENCIES, 'USD'),
    taxRate: v.num(b.taxRate, 'taxRate', { required: false, min: 0, max: 100 }) ?? 0,
    paymentInstructions: v.str(b.paymentInstructions, 'paymentInstructions', { max: 2000 }),
    footer: v.str(b.footer, 'footer', { max: 300 }),
    logo: typeof b.logo === 'string' ? b.logo : '',
  };
  if (update.logo && !/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/i.test(update.logo)) {
    v.fail('logo', 'must be a PNG or JPEG image');
  }
  if (update.logo.length > MAX_LOGO_CHARS) v.fail('logo', 'must be smaller than 500 KB');
  v.throwIfErrors();

  await Settings.updateOne({ key: 'default' }, { $set: update }, { upsert: true, runValidators: true });
  res.json(await getSettings());
});

export default router;
