const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('./config');

const storage = multer.diskStorage({
  destination: config.uploadDir,
  filename: (req, file, cb) => {
    // Dateinamen aus dem Browser kommen als latin1 an – für Umlaute korrigieren.
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

function removeFile(name) {
  if (!name) return;
  fs.rm(path.join(config.uploadDir, path.basename(name)), { force: true }, () => {});
}

module.exports = { upload, removeFile };
