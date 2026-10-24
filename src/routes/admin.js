const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { upload, removeFile } = require('../upload');
const { loadCourseTree, progressMatrix, nextPosition, move } = require('../helpers');

const router = express.Router();
router.use(requireAdmin);

const str = (v) => String(v ?? '').trim();
const intOrNull = (v) => (str(v) === '' ? null : Math.max(0, parseInt(v, 10) || 0));
const notFound = (res) => res.status(404).render('error', { title: 'Nicht gefunden', message: 'Eintrag existiert nicht.' });

// ---------- Übersicht ----------

router.get('/', (req, res) => {
  const stats = {
    courses: db.prepare('SELECT COUNT(*) n FROM courses').get().n,
    lessons: db.prepare('SELECT COUNT(*) n FROM lessons').get().n,
    users: db.prepare("SELECT COUNT(*) n FROM users WHERE active = 1 AND role = 'mitarbeiter'").get().n,
    completions: db.prepare("SELECT COUNT(*) n FROM progress WHERE completed_at > datetime('now', '-7 days')").get().n,
  };
  const recent = db
    .prepare(
      `SELECT p.completed_at, u.name, l.title AS lesson, c.title AS course FROM progress p
       JOIN users u ON u.id = p.user_id JOIN lessons l ON l.id = p.lesson_id
       JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
       ORDER BY p.completed_at DESC LIMIT 10`
    )
    .all();
  res.render('admin/index', { title: 'Admin', stats, recent });
});

// ---------- Kurse ----------

router.get('/kurse', (req, res) => {
  const courses = db.prepare('SELECT id FROM courses ORDER BY position, id').all().map((c) => loadCourseTree(c.id));
  res.render('admin/courses', { title: 'Kurse verwalten', courses });
});

router.get('/kurse/neu', (req, res) => {
  res.render('admin/course-form', { title: 'Neuer Kurs', course: { title: '', description: '', category: '', published: 0 } });
});

router.post('/kurse', upload.single('cover'), (req, res) => {
  const title = str(req.body.title);
  if (!title) {
    req.flash('error', 'Bitte einen Titel angeben.');
    return res.redirect('/admin/kurse/neu');
  }
  const position = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 p FROM courses').get().p;
  const r = db
    .prepare('INSERT INTO courses (title, description, category, cover_file, published, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title, str(req.body.description), str(req.body.category), req.file?.filename ?? null, req.body.published ? 1 : 0, position);
  req.flash('success', 'Kurs angelegt. Füge jetzt Module und Lektionen hinzu.');
  res.redirect(`/admin/kurse/${r.lastInsertRowid}`);
});

router.get('/kurse/:id', (req, res) => {
  const course = loadCourseTree(req.params.id);
  if (!course) return notFound(res);
  res.render('admin/course-edit', { title: course.title, course });
});

router.post('/kurse/:id', upload.single('cover'), (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return notFound(res);
  let cover = course.cover_file;
  if (req.file || req.body.remove_cover) {
    removeFile(cover);
    cover = req.file?.filename ?? null;
  }
  db.prepare('UPDATE courses SET title = ?, description = ?, category = ?, cover_file = ?, published = ? WHERE id = ?').run(
    str(req.body.title) || course.title,
    str(req.body.description),
    str(req.body.category),
    cover,
    req.body.published ? 1 : 0,
    course.id
  );
  req.flash('success', 'Kurs gespeichert.');
  res.redirect(`/admin/kurse/${course.id}`);
});

router.post('/kurse/:id/verschieben', (req, res) => {
  const ids = db.prepare('SELECT id FROM courses ORDER BY position, id').all().map((r) => r.id);
  const i = ids.indexOf(Number(req.params.id));
  const j = req.body.dir === 'up' ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < ids.length) {
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const u = db.prepare('UPDATE courses SET position = ? WHERE id = ?');
    db.transaction(() => ids.forEach((id, idx) => u.run(idx + 1, id)))();
  }
  res.redirect('/admin/kurse');
});

router.post('/kurse/:id/loeschen', (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return notFound(res);
  const files = db
    .prepare(
      `SELECT l.video_file AS f FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.course_id = ?
       UNION ALL SELECT a.stored_name FROM attachments a JOIN lessons l ON l.id = a.lesson_id
       JOIN modules m ON m.id = l.module_id WHERE m.course_id = ?`
    )
    .all(course.id, course.id);
  db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
  [course.cover_file, ...files.map((f) => f.f)].forEach(removeFile);
  req.flash('success', `Kurs „${course.title}“ gelöscht.`);
  res.redirect('/admin/kurse');
});

// ---------- Module ----------

router.post('/kurse/:id/module', (req, res) => {
  const title = str(req.body.title);
  if (title) {
    db.prepare('INSERT INTO modules (course_id, title, position) VALUES (?, ?, ?)').run(
      req.params.id,
      title,
      nextPosition('modules', 'course_id', req.params.id)
    );
  }
  res.redirect(`/admin/kurse/${req.params.id}`);
});

router.post('/module/:id', (req, res) => {
  const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!mod) return notFound(res);
  if (req.body.dir) move('modules', 'course_id', mod.id, req.body.dir);
  else if (str(req.body.title)) db.prepare('UPDATE modules SET title = ? WHERE id = ?').run(str(req.body.title), mod.id);
  res.redirect(`/admin/kurse/${mod.course_id}`);
});

router.post('/module/:id/loeschen', (req, res) => {
  const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!mod) return notFound(res);
  const files = db
    .prepare(
      `SELECT video_file AS f FROM lessons WHERE module_id = ?
       UNION ALL SELECT a.stored_name FROM attachments a JOIN lessons l ON l.id = a.lesson_id WHERE l.module_id = ?`
    )
    .all(mod.id, mod.id);
  db.prepare('DELETE FROM modules WHERE id = ?').run(mod.id);
  files.forEach((f) => removeFile(f.f));
  req.flash('success', 'Modul gelöscht.');
  res.redirect(`/admin/kurse/${mod.course_id}`);
});

// ---------- Lektionen ----------

const lessonUpload = upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'attachments', maxCount: 20 },
]);

function saveAttachments(lessonId, files = []) {
  const ins = db.prepare('INSERT INTO attachments (lesson_id, original_name, stored_name, size) VALUES (?, ?, ?, ?)');
  for (const f of files) ins.run(lessonId, f.originalname, f.filename, f.size);
}

router.get('/module/:id/lektionen/neu', (req, res) => {
  const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!mod) return notFound(res);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(mod.course_id);
  res.render('admin/lesson-form', {
    title: 'Neue Lektion',
    mod,
    course,
    lesson: { title: '', content: '', video_url: '', duration_min: null },
    attachments: [],
  });
});

router.post('/module/:id/lektionen', lessonUpload, (req, res) => {
  const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!mod) return notFound(res);
  const r = db
    .prepare('INSERT INTO lessons (module_id, title, content, video_url, video_file, duration_min, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      mod.id,
      str(req.body.title) || 'Neue Lektion',
      String(req.body.content || ''),
      str(req.body.video_url),
      req.files?.video?.[0]?.filename ?? null,
      intOrNull(req.body.duration_min),
      nextPosition('lessons', 'module_id', mod.id)
    );
  saveAttachments(r.lastInsertRowid, req.files?.attachments);
  req.flash('success', 'Lektion angelegt.');
  res.redirect(`/admin/kurse/${mod.course_id}`);
});

router.get('/lektionen/:id', (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return notFound(res);
  const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(lesson.module_id);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(mod.course_id);
  const attachments = db.prepare('SELECT * FROM attachments WHERE lesson_id = ? ORDER BY id').all(lesson.id);
  const modules = db.prepare('SELECT * FROM modules WHERE course_id = ? ORDER BY position, id').all(course.id);
  res.render('admin/lesson-form', { title: lesson.title, lesson, mod, course, attachments, modules });
});

router.post('/lektionen/:id', lessonUpload, (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return notFound(res);
  const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(lesson.module_id);

  let videoFile = lesson.video_file;
  const newVideo = req.files?.video?.[0];
  if (newVideo || req.body.remove_video) {
    removeFile(videoFile);
    videoFile = newVideo?.filename ?? null;
  }
  // Verschieben in ein anderes Modul desselben Kurses
  let moduleId = lesson.module_id;
  const target = Number(req.body.module_id);
  if (target && target !== moduleId) {
    const t = db.prepare('SELECT * FROM modules WHERE id = ? AND course_id = ?').get(target, mod.course_id);
    if (t) moduleId = t.id;
  }
  db.prepare(
    'UPDATE lessons SET title = ?, content = ?, video_url = ?, video_file = ?, duration_min = ?, module_id = ?, position = ? WHERE id = ?'
  ).run(
    str(req.body.title) || lesson.title,
    String(req.body.content || ''),
    str(req.body.video_url),
    videoFile,
    intOrNull(req.body.duration_min),
    moduleId,
    moduleId === lesson.module_id ? lesson.position : nextPosition('lessons', 'module_id', moduleId),
    lesson.id
  );
  saveAttachments(lesson.id, req.files?.attachments);
  req.flash('success', 'Lektion gespeichert.');
  res.redirect(`/admin/lektionen/${lesson.id}`);
});

router.post('/lektionen/:id/verschieben', (req, res) => {
  const lesson = db.prepare('SELECT l.*, m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?').get(req.params.id);
  if (!lesson) return notFound(res);
  move('lessons', 'module_id', lesson.id, req.body.dir);
  res.redirect(`/admin/kurse/${lesson.course_id}`);
});

router.post('/lektionen/:id/loeschen', (req, res) => {
  const lesson = db.prepare('SELECT l.*, m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?').get(req.params.id);
  if (!lesson) return notFound(res);
  const files = db.prepare('SELECT stored_name FROM attachments WHERE lesson_id = ?').all(lesson.id);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.id);
  [lesson.video_file, ...files.map((f) => f.stored_name)].forEach(removeFile);
  req.flash('success', 'Lektion gelöscht.');
  res.redirect(`/admin/kurse/${lesson.course_id}`);
});

router.post('/anhaenge/:id/loeschen', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return notFound(res);
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  removeFile(a.stored_name);
  res.redirect(`/admin/lektionen/${a.lesson_id}`);
});

// ---------- Mitarbeiter ----------

router.get('/mitarbeiter', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY active DESC, name').all();
  const courses = db.prepare('SELECT id, title FROM courses WHERE published = 1 ORDER BY position, id').all();
  const { matrix, totalBy } = progressMatrix();
  res.render('admin/users', { title: 'Mitarbeiter & Fortschritt', users, courses, matrix, totalBy });
});

router.post('/mitarbeiter', (req, res) => {
  const name = str(req.body.name);
  const email = str(req.body.email).toLowerCase();
  if (!name || !email) {
    req.flash('error', 'Name und E-Mail sind Pflichtfelder.');
    return res.redirect('/admin/mitarbeiter');
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    req.flash('error', 'Diese E-Mail ist bereits vergeben.');
    return res.redirect('/admin/mitarbeiter');
  }
  const password = str(req.body.password) || crypto.randomBytes(6).toString('base64url');
  const role = req.body.role === 'admin' ? 'admin' : 'mitarbeiter';
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, bcrypt.hashSync(password, 10), role);
  req.flash('success', `${name} angelegt. Zugangsdaten: ${email} / ${password}`);
  res.redirect('/admin/mitarbeiter');
});

router.get('/mitarbeiter/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!member) return notFound(res);
  const courses = db.prepare('SELECT id FROM courses ORDER BY position, id').all().map((c) => loadCourseTree(c.id, member.id));
  res.render('admin/user', { title: member.name, member, courses });
});

router.post('/mitarbeiter/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!member) return notFound(res);
  const self = member.id === req.user.id;
  const action = req.body.action;

  if (action === 'password') {
    const password = str(req.body.password) || crypto.randomBytes(6).toString('base64url');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), member.id);
    req.flash('success', `Neues Passwort für ${member.name}: ${password}`);
  } else if (action === 'toggle' && !self) {
    db.prepare('UPDATE users SET active = 1 - active WHERE id = ?').run(member.id);
    req.flash('success', member.active ? `${member.name} deaktiviert.` : `${member.name} aktiviert.`);
  } else if (action === 'reset-progress') {
    db.prepare('DELETE FROM progress WHERE user_id = ?').run(member.id);
    req.flash('success', 'Fortschritt zurückgesetzt.');
  } else if (action === 'update') {
    const email = str(req.body.email).toLowerCase() || member.email;
    const clash = db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, member.id);
    if (clash) {
      req.flash('error', 'Diese E-Mail ist bereits vergeben.');
    } else {
      const role = self ? member.role : req.body.role === 'admin' ? 'admin' : 'mitarbeiter';
      db.prepare('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?').run(str(req.body.name) || member.name, email, role, member.id);
      req.flash('success', 'Gespeichert.');
    }
  }
  res.redirect(`/admin/mitarbeiter/${member.id}`);
});

router.post('/mitarbeiter/:id/loeschen', (req, res) => {
  const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!member || member.id === req.user.id) return res.redirect('/admin/mitarbeiter');
  db.prepare('DELETE FROM users WHERE id = ?').run(member.id);
  req.flash('success', `${member.name} gelöscht.`);
  res.redirect('/admin/mitarbeiter');
});

module.exports = router;
