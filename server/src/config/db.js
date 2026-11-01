import mongoose from 'mongoose';

/** Connects to the existing MongoDB configured through MONGODB_URI (never hardcoded). */
export async function connectDB(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI is not set. Copy server/.env.example to server/.env and configure it.');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  return mongoose.connection;
}
