# Madrasa Fund Management & Transparency System

A simple website that shows a Madrasa's donations, expenses and balance publicly, while keeping donor phone numbers
and private donor names hidden. Includes a secure admin panel.

## Run it (Windows / Mac / Linux)
1. Install Node.js 22.13 or newer from nodejs.org
2. In this folder run:  `npm install`
3. Copy `.env.example` to `.env` (Windows: `copy .env.example .env`) and fill in ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
4. Create your admin account:  `npm run seed`
5. Start:  `npm start`  then open http://localhost:3000  (admin: http://localhost:3000/admin/login)

## Branding
The Madrasa name (English and Bengali), short name, address, phone, description and logo are all editable in Admin → Settings.
The colours are the first lines of `public/style.css` (`--green`, `--gold`). The footer credit "Website powered by AJ Limited" is in `views/partials/footer.ejs`.

## Everyday commands
- `npm test`        runs all automated tests (privacy, totals, reports, the 8 final scenarios)
- `npm run backup`  saves a copy of the database into the `backups` folder
- `npm run seed`    creates the admin, or resets the admin password to the value in `.env`

## Where is my data?
Everything (donations, expenses, settings, the logo) is in ONE file: `madrasa.db`. Back it up regularly with `npm run backup`
and keep copies off this computer (USB drive or cloud storage).

## Going live checklist
1. Host it on a server/VPS or a host with a PERSISTENT DISK (the database is a file; hosts that erase files on restart will lose data).
2. Serve it over HTTPS only (most hosts and Caddy/Nginx/Cloudflare can do this for you).
3. In `.env` set `NODE_ENV=production`, a long random `SESSION_SECRET` (20+ characters), and `TRUST_PROXY=1` if the host puts a proxy in front.
   In production the app refuses to start without a proper SESSION_SECRET.
4. Use a strong admin password, then run `npm run seed`.
5. Schedule `npm run backup` daily and copy the backups somewhere safe.
6. After any code change, run `npm test` before publishing.

## Privacy design
- Every public query lives in `publicData.js`. It picks the display name inside the database query (real name only when PUBLIC, otherwise
  "Anonymous Donor") and never loads phone numbers, notes or admin data.
- `tests/privacy.test.js` and `tests/scenarios.test.js` fail if a phone number, private name or note ever appears on a public page or API.
