const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(path.join(config.dataDir, 'akademie.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'mitarbeiter' CHECK (role IN ('admin', 'mitarbeiter')),
    active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    cover_file TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    video_url TEXT NOT NULL DEFAULT '',
    video_file TEXT,
    duration_min INTEGER,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, lesson_id)
  );

  CREATE INDEX IF NOT EXISTS idx_modules_course ON modules(course_id);
  CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons(module_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_lesson ON attachments(lesson_id);
`);

function seed() {
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  if (hasUsers) return;

  db.prepare(
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`
  ).run('Administrator', config.adminEmail, bcrypt.hashSync(config.adminPassword, 10));
  console.log(`\n  Admin-Zugang angelegt: ${config.adminEmail} / ${config.adminPassword}`);
  console.log('  Bitte nach dem ersten Login das Passwort unter "Profil" ändern.\n');

  const course = db.prepare(
    `INSERT INTO courses (title, description, category, published, position) VALUES (?, ?, ?, 1, 1)`
  ).run(
    'Willkommen in der Agentur',
    'Dein Onboarding: Wer wir sind, wie wir arbeiten und welche Tools wir nutzen.',
    'Onboarding'
  );
  const addModule = db.prepare('INSERT INTO modules (course_id, title, position) VALUES (?, ?, ?)');
  const addLesson = db.prepare(
    'INSERT INTO lessons (module_id, title, content, video_url, duration_min, position) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const m1 = addModule.run(course.lastInsertRowid, 'Start', 1).lastInsertRowid;
  addLesson.run(
    m1,
    'Begrüßung',
    '## Schön, dass du da bist!\n\nIn diesem Kurs lernst du unsere Agentur kennen.\n\n- Unsere Werte\n- Ansprechpartner\n- Erste Schritte\n\n*Tipp für Admins: Unter „Admin → Kurse“ kannst du hier ein Video (YouTube, Vimeo, Loom oder Upload) hinterlegen.*',
    '',
    3,
    1
  );
  addLesson.run(m1, 'Unsere Werte', 'Ersetze diesen Text im Admin-Bereich durch eure eigenen Inhalte.', '', 5, 2);
  const m2 = addModule.run(course.lastInsertRowid, 'Tools & Abläufe', 2).lastInsertRowid;
  addLesson.run(m2, 'Unser Tool-Stack', 'Welche Tools wir täglich nutzen und wofür.', '', 8, 1);
}

seed();

module.exports = db;
