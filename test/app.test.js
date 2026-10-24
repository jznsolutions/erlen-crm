const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'akademie-test-'));
process.env.ADMIN_EMAIL = 'admin@test.de';
process.env.ADMIN_PASSWORD = 'geheim123';

const app = require('../src/server');
let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

// Minimaler Browser: merkt sich Cookies und das CSRF-Token der letzten Seite.
function client() {
  let cookie = '';
  let csrf = '';
  async function req(method, url, body) {
    const opts = { method, redirect: 'manual', headers: { cookie } };
    if (body instanceof FormData) {
      opts.body = body;
      url += (url.includes('?') ? '&' : '?') + `_csrf=${csrf}`;
    } else if (body) {
      opts.headers['content-type'] = 'application/x-www-form-urlencoded';
      opts.body = new URLSearchParams({ _csrf: csrf, ...body }).toString();
    }
    const res = await fetch(base + url, opts);
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    if (set.length) cookie = set.join('; ');
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/) || text.match(/_csrf=([a-f0-9]+)/);
    if (m) csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }
  return {
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b),
    cookie: () => cookie,
  };
}

async function login(email, password) {
  const c = client();
  await c.get('/login');
  const r = await c.post('/login', { email, password });
  assert.strictEqual(r.status, 302, 'Login sollte weiterleiten');
  return c;
}

test('nicht eingeloggte Nutzer werden zum Login geschickt', async () => {
  const r = await client().get('/');
  assert.strictEqual(r.status, 302);
  assert.match(r.location, /^\/login/);
});

test('falsches Passwort wird abgelehnt', async () => {
  const c = client();
  await c.get('/login');
  const r = await c.post('/login', { email: 'admin@test.de', password: 'falsch' });
  assert.strictEqual(r.status, 401);
});

test('POST ohne CSRF-Token wird abgelehnt', async () => {
  const r = await fetch(base + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=admin@test.de&password=geheim123',
  });
  assert.strictEqual(r.status, 403);
});

test('kompletter Ablauf: Kurs anlegen, Mitarbeiter lernt, Admin sieht Fortschritt', async () => {
  const admin = await login('admin@test.de', 'geheim123');
  assert.match((await admin.get('/')).text, /Willkommen in der Agentur/, 'Beispielkurs vorhanden');

  // Kurs anlegen (multipart)
  await admin.get('/admin/kurse/neu');
  const fd = new FormData();
  fd.set('title', 'SEO Grundlagen');
  fd.set('category', 'Marketing');
  fd.set('description', 'Alles über SEO');
  fd.set('published', '1');
  let r = await admin.post('/admin/kurse', fd);
  assert.strictEqual(r.status, 302);
  const courseUrl = r.location;
  const courseId = courseUrl.split('/').pop();

  await admin.get(courseUrl);
  await admin.post(`/admin/kurse/${courseId}/module`, { title: 'Keywords' });
  const edit = await admin.get(courseUrl);
  const moduleId = edit.text.match(/\/admin\/module\/(\d+)\/lektionen\/neu/)[1];

  // Zwei Lektionen, eine mit Video-Upload und Anhang
  await admin.get(`/admin/module/${moduleId}/lektionen/neu`);
  const l1 = new FormData();
  l1.set('title', 'Keyword-Recherche');
  l1.set('content', '## Überschrift\n\n<script>alert(1)</script>');
  l1.set('video', new Blob([Buffer.alloc(2048, 1)], { type: 'video/mp4' }), 'intro.mp4');
  l1.set('attachments', new Blob(['%PDF-1.4 test']), 'Checkliste_Übersicht.pdf');
  r = await admin.post(`/admin/module/${moduleId}/lektionen`, l1);
  assert.strictEqual(r.status, 302);
  await admin.get(courseUrl);
  const l2 = new FormData();
  l2.set('title', 'Tools');
  l2.set('video_url', 'https://youtu.be/abc123');
  await admin.post(`/admin/module/${moduleId}/lektionen`, l2);

  // Mitarbeiter anlegen
  await admin.get('/admin/mitarbeiter');
  r = await admin.post('/admin/mitarbeiter', { name: 'Lisa Muster', email: 'lisa@test.de', password: 'lisa12345', role: 'mitarbeiter' });
  assert.strictEqual(r.status, 302);

  // Mitarbeiter lernt
  const lisa = await login('lisa@test.de', 'lisa12345');
  const dash = await lisa.get('/');
  assert.match(dash.text, /SEO Grundlagen/);
  const course = await lisa.get(`/kurse/${courseId}`);
  const lessonIds = [...course.text.matchAll(/href="\/lektionen\/(\d+)"/g)].map((m) => m[1]);
  const [first, second] = [...new Set(lessonIds)];

  const lesson = await lisa.get(`/lektionen/${first}`);
  assert.match(lesson.text, /<video src="\/medien\//, 'hochgeladenes Video wird abgespielt');
  assert.match(lesson.text, /<h2>Überschrift<\/h2>/, 'Markdown wird gerendert');
  assert.doesNotMatch(lesson.text, /<script>alert/, 'HTML im Inhalt wird escaped');
  assert.match(lesson.text, /Checkliste_Übersicht\.pdf/, 'Umlaute im Dateinamen bleiben erhalten');

  const videoSrc = lesson.text.match(/<video src="(\/medien\/[^"]+)"/)[1];
  const ranged = await fetch(base + videoSrc, { redirect: 'manual', headers: { range: 'bytes=0-99' } });
  assert.strictEqual(ranged.status, 302, 'Medien nur mit Login');
  const partial = await fetch(base + videoSrc, { headers: { range: 'bytes=0-99', cookie: lisa.cookie() } });
  assert.strictEqual(partial.status, 206, 'Videos unterstützen Spulen (Range)');

  const attId = lesson.text.match(/href="\/anhang\/(\d+)"/)[1];
  const dl = await lisa.get(`/anhang/${attId}`);
  assert.strictEqual(dl.status, 200);
  assert.match(dl.text, /%PDF/);

  r = await lisa.post(`/lektionen/${first}/abschliessen`, { next: second });
  assert.strictEqual(r.location, `/lektionen/${second}`);
  const yt = await lisa.get(`/lektionen/${second}`);
  assert.match(yt.text, /youtube-nocookie\.com\/embed\/abc123/);
  assert.match((await lisa.get(`/kurse/${courseId}`)).text, /1 von 2 Lektionen abgeschlossen/);

  // Mitarbeiter hat keinen Admin-Zugriff
  assert.strictEqual((await lisa.get('/admin')).status, 403);

  // Admin sieht Fortschritt
  const users = await admin.get('/admin/mitarbeiter');
  assert.match(users.text, /Lisa Muster/);
  assert.match(users.text, /50 %/);

  // Entwürfe sind für Mitarbeiter unsichtbar
  await admin.get(courseUrl);
  const unpublish = new FormData();
  unpublish.set('title', 'SEO Grundlagen');
  await admin.post(`/admin/kurse/${courseId}`, unpublish);
  assert.strictEqual((await lisa.get(`/kurse/${courseId}`)).status, 404);
  assert.strictEqual((await admin.get(`/kurse/${courseId}`)).status, 200);

  // Kurs löschen räumt Dateien auf
  await admin.get(courseUrl);
  await admin.post(`/admin/kurse/${courseId}/loeschen`, {});
  await new Promise((res) => setTimeout(res, 50));
  const left = fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads'));
  assert.deepStrictEqual(left, []);
});
