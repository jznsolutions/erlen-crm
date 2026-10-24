const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const config = require('./config');
const helpers = require('./helpers');
const { loadUser, csrf } = require('./auth');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(
  cookieSession({
    name: 'akademie',
    secret: config.sessionSecret,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: config.secureCookies,
  })
);
app.use((req, res, next) => {
  res.locals.appName = config.appName;
  res.locals.h = helpers;
  res.locals.path = req.path;
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  req.flash = (type, text) => (req.session.flash = { type, text });
  next();
});
app.use(loadUser);
app.use(csrf);

app.use(require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use(require('./routes/learn'));

app.use((req, res) => res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' }));
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).render('error', { title: 'Datei zu groß', message: `Maximal ${config.maxUploadMb} MB pro Datei.` });
  }
  console.error(err);
  res.status(500).render('error', { title: 'Fehler', message: 'Da ist etwas schiefgelaufen.' });
});

if (require.main === module) {
  app.listen(config.port, () => console.log(`${config.appName} läuft auf http://localhost:${config.port}`));
}

module.exports = app;
