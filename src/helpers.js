const { marked } = require('marked');
const db = require('./db');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Markdown für Lektionstexte; rohes HTML wird escaped, damit nichts eingeschleust werden kann.
marked.use({
  renderer: {
    html(token) {
      return escapeHtml(token.text);
    },
  },
});

function renderMarkdown(text) {
  return marked.parse(text || '');
}

// Wandelt YouTube-/Vimeo-/Loom-Links in Embed-URLs um. Gibt null zurück, wenn der Link
// direkt als <video> abgespielt werden soll.
function videoEmbed(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}` };
  if (host.endsWith('youtube.com')) {
    const id = u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
    if (id) return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'vimeo.com') {
    const [id, hash] = u.pathname.split('/').filter(Boolean);
    if (/^\d+$/.test(id)) return { type: 'iframe', src: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}` };
  }
  if (host === 'player.vimeo.com') return { type: 'iframe', src: url };
  if (host === 'loom.com') {
    const id = u.pathname.match(/\/(?:share|embed)\/([^/?]+)/)?.[1];
    if (id) return { type: 'iframe', src: `https://www.loom.com/embed/${id}` };
  }
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(u.pathname)) return { type: 'video', src: url };
  return { type: 'link', src: url };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(s) {
  if (!s) return '–';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Lädt einen Kurs mit Modulen, Lektionen und (optional) dem Fortschritt eines Nutzers.
function loadCourseTree(courseId, userId) {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  if (!course) return null;
  const modules = db.prepare('SELECT * FROM modules WHERE course_id = ? ORDER BY position, id').all(courseId);
  const lessons = db
    .prepare(
      `SELECT l.*, p.completed_at FROM lessons l
       JOIN modules m ON m.id = l.module_id
       LEFT JOIN progress p ON p.lesson_id = l.id AND p.user_id = ?
       WHERE m.course_id = ? ORDER BY l.position, l.id`
    )
    .all(userId ?? -1, courseId);
  for (const m of modules) m.lessons = lessons.filter((l) => l.module_id === m.id);
  const flat = modules.flatMap((m) => m.lessons);
  const done = flat.filter((l) => l.completed_at).length;
  course.modules = modules;
  course.lessons = flat;
  course.totalLessons = flat.length;
  course.doneLessons = done;
  course.percent = flat.length ? Math.round((done / flat.length) * 100) : 0;
  course.totalMinutes = flat.reduce((s, l) => s + (l.duration_min || 0), 0);
  return course;
}

// Fortschritt aller Nutzer über alle Kurse: { [userId]: { [courseId]: {done,total,percent} } }
function progressMatrix() {
  const totals = db
    .prepare(
      `SELECT c.id AS course_id, COUNT(l.id) AS total FROM courses c
       LEFT JOIN modules m ON m.course_id = c.id
       LEFT JOIN lessons l ON l.module_id = m.id GROUP BY c.id`
    )
    .all();
  const done = db
    .prepare(
      `SELECT p.user_id, m.course_id, COUNT(*) AS done FROM progress p
       JOIN lessons l ON l.id = p.lesson_id JOIN modules m ON m.id = l.module_id
       GROUP BY p.user_id, m.course_id`
    )
    .all();
  const totalBy = Object.fromEntries(totals.map((t) => [t.course_id, t.total]));
  const matrix = {};
  for (const d of done) {
    const total = totalBy[d.course_id] || 0;
    (matrix[d.user_id] ||= {})[d.course_id] = {
      done: d.done,
      total,
      percent: total ? Math.round((d.done / total) * 100) : 0,
    };
  }
  return { matrix, totalBy };
}

function nextPosition(table, column, value) {
  return db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ${table} WHERE ${column} = ?`).get(value).p;
}

// Tauscht die Position eines Eintrags mit seinem Nachbarn (up/down) innerhalb der Gruppe.
function move(table, groupColumn, id, direction) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return;
  const siblings = db
    .prepare(`SELECT id FROM ${table} WHERE ${groupColumn} = ? ORDER BY position, id`)
    .all(row[groupColumn])
    .map((r) => r.id);
  const i = siblings.indexOf(row.id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  const update = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
  db.transaction(() => siblings.forEach((sid, idx) => update.run(idx + 1, sid)))();
}

module.exports = {
  escapeHtml,
  renderMarkdown,
  videoEmbed,
  formatBytes,
  formatDate,
  loadCourseTree,
  progressMatrix,
  nextPosition,
  move,
};
