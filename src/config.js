const path = require('node:path');

const root = path.join(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  appName: process.env.APP_NAME || 'Agentur Akademie',
  sessionSecret: process.env.SESSION_SECRET || 'bitte-in-produktion-aendern',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@agentur.de',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 2048,
  secureCookies: process.env.SECURE_COOKIES === 'true',
};
