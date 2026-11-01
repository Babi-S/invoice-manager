import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { Invoice } from './models/Invoice.js';
import { Settings } from './models/Settings.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 5050;

try {
  const conn = await connectDB();
  // Make sure the unique indexes exist before any invoice is written.
  await Promise.all([Invoice.init(), Settings.init()]);
  const server = createApp().listen(PORT, HOST, (err) => {
    if (err) return;
    console.log(`Invoice manager on http://${HOST}:${PORT}  (database: ${conn.db.databaseName})`);
  });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : err.message);
    process.exit(1);
  });
} catch (err) {
  console.error('Failed to start:', err.message);
  process.exit(1);
}
