# Agentur Akademie

Interne Lern- und Videoplattform für Mitarbeiter, eine selbst gehostete Alternative zu Memberspot.

## Funktionen

**Für Mitarbeiter**
- Login mit persönlichem Zugang
- Kursübersicht nach Kategorien (z. B. Onboarding, SEO, Social Media) mit Suche
- Kurse mit Modulen und Lektionen, Video-Player und Lektions-Navigation
- Videos per YouTube-, Vimeo- oder Loom-Link oder als eigener Upload (mit Spulen)
- Unterlagen zum Download (PDFs, Vorlagen, Präsentationen …)
- Lernfortschritt: Lektionen abhaken, Fortschrittsbalken, „Weitermachen“-Bereich
- Passwort selbst ändern

**Für Admins**
- Kurse anlegen, mit Titelbild, Kategorie und Beschreibung; als Entwurf oder veröffentlicht
- Module und Lektionen anlegen, umbenennen, sortieren, zwischen Modulen verschieben
- Lektionstexte in Markdown, Videos und Dateianhänge hochladen
- Mitarbeiter anlegen, als Admin festlegen, deaktivieren, Passwort zurücksetzen
- Fortschritts-Übersicht: alle Mitarbeiter × alle Kurse, plus Detailansicht pro Person
- Übersicht mit der letzten Lernaktivität

## Starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm start
```

Danach http://localhost:3000 öffnen. Beim ersten Start werden ein Admin-Zugang und ein Beispielkurs angelegt:

- E-Mail: `admin@agentur.de`
- Passwort: `admin123`

**Ändere das Passwort direkt nach dem ersten Login unter „Profil“.**

## Konfiguration

Die Einstellungen werden als Umgebungsvariablen gesetzt:

| Variable          | Standard                     | Bedeutung                                                                 |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `PORT`            | `3000`                       | Port des Servers                                                          |
| `APP_NAME`        | `Agentur Akademie`           | Name der Plattform, wird oben links angezeigt                             |
| `SESSION_SECRET`  | (unsicherer Standardwert)    | **In Produktion unbedingt setzen** (langer Zufallswert)                   |
| `ADMIN_EMAIL`     | `admin@agentur.de`           | Erster Admin, wird nur beim allerersten Start angelegt                    |
| `ADMIN_PASSWORD`  | `admin123`                   | Passwort des ersten Admins                                                |
| `DATA_DIR`        | `./data`                     | Ablage für die Datenbank (SQLite) und die Uploads                         |
| `MAX_UPLOAD_MB`   | `2048`                       | Maximale Größe pro hochgeladener Datei                                    |
| `SECURE_COOKIES`  | `false`                      | Auf `true` setzen, wenn die Plattform per HTTPS läuft                     |

Beispiel:

```bash
APP_NAME="Erlen Akademie" SESSION_SECRET="$(openssl rand -hex 32)" npm start
```

## Online stellen (Docker)

```bash
docker build -t akademie .
docker run -d -p 3000:3000 -v akademie-daten:/app/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e APP_NAME="Erlen Akademie" \
  -e SECURE_COOKIES=true \
  akademie
```

Davor gehört ein Reverse-Proxy mit HTTPS, z. B. Caddy, nginx oder das Hosting-Panel. Alle Daten liegen im Volume `/app/data`. Für ein Backup sicherst du diesen Ordner.

## Tipps für Videos

- Für viele oder lange Videos sind **nicht gelistete YouTube-Videos** oder **Vimeo mit Domain-Beschränkung** meist die beste Wahl, weil sie Server und Bandbreite sparen.
- Hochgeladene Videos sind nur für eingeloggte Nutzer erreichbar. Am besten eignet sich MP4 (H.264).
- Bildschirmaufnahmen lassen sich schnell mit Loom erstellen und per Link einbinden.

## Entwicklung

```bash
npm run dev   # Neustart bei Dateiänderungen
npm test      # automatische Tests
```

Aufbau: Express 5, EJS-Templates, SQLite (better-sqlite3), keine Build-Schritte.

```
src/
  server.js        App-Setup
  db.js            Datenbankschema & erster Start
  auth.js          Login, Rollen, CSRF-Schutz
  helpers.js       Video-Einbettung, Markdown, Fortschritt
  routes/learn.js  Mitarbeiter-Bereich
  routes/admin.js  Admin-Bereich
views/             Seiten-Templates
public/style.css   Design
```
