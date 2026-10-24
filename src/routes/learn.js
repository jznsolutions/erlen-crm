const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../auth');
const { loadCourseTree } = require('../helpers');

const router = express.Router();
router.use(requireLogin);

const isAdmin = (req) => req.user.role === 'admin';

// Entwürfe sind nur für Admins (als Vorschau) sichtbar.
function visibleCourse(req, courseId) {
  const course = loadCourseTree(courseId, req.user.id);
  if (!course || (!course.published && !isAdmin(req))) return null;
  return course;
}

function notFound(res) {
  return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieser Inhalt existiert nicht (mehr).' });
}

router.get('/', (req, res) => {
  const ids = db
    .prepare(`SELECT id FROM courses ${isAdmin(req) ? '' : 'WHERE published = 1'} ORDER BY position, id`)
    .all();
  const courses = ids.map((c) => loadCourseTree(c.id, req.user.id));
  const q = String(req.query.q || '').trim().toLowerCase();
  const filtered = q
    ? courses.filter((c) =>
        [c.title, c.description, c.category, ...c.lessons.map((l) => l.title)].join(' ').toLowerCase().includes(q)
      )
    : courses;
  const inProgress = courses.filter((c) => c.doneLessons > 0 && c.percent < 100);
  const categories = [...new Set(filtered.map((c) => c.category || 'Allgemein'))];
  res.render('dashboard', { title: 'Meine Kurse', courses: filtered, inProgress, categories, q: req.query.q || '' });
});

router.get('/kurse/:id', (req, res) => {
  const course = visibleCourse(req, req.params.id);
  if (!course) return notFound(res);
  const next = course.lessons.find((l) => !l.completed_at) || course.lessons[0];
  res.render('course', { title: course.title, course, next });
});

router.get('/lektionen/:id', (req, res) => {
  const row = db
    .prepare('SELECT m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?')
    .get(req.params.id);
  const course = row && visibleCourse(req, row.course_id);
  if (!course) return notFound(res);
  const idx = course.lessons.findIndex((l) => l.id === Number(req.params.id));
  const lesson = course.lessons[idx];
  const attachments = db.prepare('SELECT * FROM attachments WHERE lesson_id = ? ORDER BY id').all(lesson.id);
  res.render('lesson', {
    title: lesson.title,
    course,
    lesson,
    attachments,
    prev: course.lessons[idx - 1],
    next: course.lessons[idx + 1],
  });
});

router.post('/lektionen/:id/abschliessen', (req, res) => {
  const lesson = db.prepare('SELECT id FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return notFound(res);
  if (req.body.done === '0') {
    db.prepare('DELETE FROM progress WHERE user_id = ? AND lesson_id = ?').run(req.user.id, lesson.id);
    return res.redirect(`/lektionen/${lesson.id}`);
  }
  db.prepare('INSERT OR IGNORE INTO progress (user_id, lesson_id) VALUES (?, ?)').run(req.user.id, lesson.id);
  res.redirect(req.body.next ? `/lektionen/${Number(req.body.next)}` : `/lektionen/${lesson.id}`);
});

// Hochgeladene Videos & Bilder – nur für eingeloggte Nutzer. sendFile unterstützt Range-Requests (Spulen).
router.get('/medien/:file', (req, res) => {
  const file = path.join(config.uploadDir, path.basename(req.params.file));
  if (!fs.existsSync(file)) return notFound(res);
  res.sendFile(file, { maxAge: '7d' });
});

router.get('/anhang/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return notFound(res);
  res.download(path.join(config.uploadDir, a.stored_name), a.original_name);
});

module.exports = router;
