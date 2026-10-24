const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../auth');

const router = express.Router();

function safeRedirect(target) {
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') ? target : '/';
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Anmelden', weiter: req.query.weiter || '', email: '' });
});

router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    res.locals.flash = { type: 'error', text: 'E-Mail oder Passwort ist falsch.' };
    return res.status(401).render('login', { title: 'Anmelden', weiter: req.body.weiter || '', email });
  }
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  req.session.userId = user.id;
  res.redirect(safeRedirect(req.body.weiter));
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

router.get('/profil', requireLogin, (req, res) => {
  res.render('profile', { title: 'Profil' });
});

router.post('/profil/passwort', requireLogin, (req, res) => {
  const { current, password, password2 } = req.body;
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) {
    req.flash('error', 'Das aktuelle Passwort ist falsch.');
  } else if (!password || password.length < 8) {
    req.flash('error', 'Das neue Passwort muss mindestens 8 Zeichen haben.');
  } else if (password !== password2) {
    req.flash('error', 'Die Passwörter stimmen nicht überein.');
  } else {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.user.id);
    req.flash('success', 'Passwort geändert.');
  }
  res.redirect('/profil');
});

module.exports = router;
