import mongoose from 'mongoose';

const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    businessName: { type: String, default: '' },
    logo: { type: String, default: '' }, // data:image/png|jpeg;base64,...
    address: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    currency: { type: String, default: 'USD' },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    paymentInstructions: { type: String, default: '' },
    footer: { type: String, default: 'Thank you for your business.' },
  },
  { timestamps: true, collection: 'invoice_settings' },
);

export const Settings = mongoose.model('Settings', SettingsSchema);

export const DEFAULT_SETTINGS = Object.freeze({
  businessName: '',
  logo: '',
  address: '',
  email: '',
  phone: '',
  currency: 'USD',
  taxRate: 0,
  paymentInstructions: '',
  footer: 'Thank you for your business.',
});

export async function getSettings() {
  const doc = await Settings.findOne({ key: 'default' }).lean();
  return { ...DEFAULT_SETTINGS, ...(doc || {}) };
}
