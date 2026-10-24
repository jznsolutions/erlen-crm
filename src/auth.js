const crypto = require('node:crypto');
const db = require('./db');

// Lädt den eingeloggten Nutzer aus der Session und stellt ihn den Views bereit.
function loadUser(req, res, next) {
  const id = req.session?.userId;
  req.user = id ? db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id) : null;
  if (id && !req.user) delete req.session.userId;
  res.locals.user = req.user;
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect(`/login?weiter=${encodeURIComponent(req.originalUrl)}`);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Dieser Bereich ist nur für Admins.' });
  next();
}

// Einfacher CSRF-Schutz: Token in der Session, Prüfung bei jedem POST.
// Bei Datei-Uploads (multipart) steckt das Token in der Query (?_csrf=...).
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const token = req.body?._csrf || req.query._csrf;
    if (token !== req.session.csrf) {
      return res.status(403).render('error', { title: 'Sitzung abgelaufen', message: 'Bitte lade die Seite neu und versuche es erneut.' });
    }
  }
  next();
}

module.exports = { loadUser, requireLogin, requireAdmin, csrf };
