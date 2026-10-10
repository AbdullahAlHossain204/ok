# Madrasa Fund Management & Transparency System

A simple website that shows a Madrasa's donations, expenses and balance publicly, while keeping donor phone numbers
and private donor names hidden. Includes a secure admin panel.

## Run it (Windows / Mac / Linux)
1. Install Node.js 22.13 or newer from nodejs.org
2. In this folder run:  `npm install`
3. Copy `.env.example` to `.env` (Windows: `copy .env.example .env`) and fill in ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
4. Create your admin account:  `npm run seed`
5. Start:  `npm start`  then open http://localhost:3000  (admin: http://localhost:3000/admin/login)

## What the public can see
Home (total collection, total expense and balance as amounts, monthly collection chart, recent donations), Donations, Statistics
(monthly collection, who donated each month, and the amount spent each month) and About.
Expense details, transaction history and funds are visible to admins only. Private donors always appear as "Anonymous Donor".

## Branding
The Madrasa name (English and Bengali), short name, address, phone, description and logo are all editable in Admin → Settings.
The colours are the first lines of `public/style.css` (`--green`, `--gold`). The logo files are in `public/img/` (the original is `logo.jpg`; the others are sharp smaller copies). If you upload a logo in Admin → Settings it replaces the built-in one.
The footer credit "Website powered by AJ Limited" is in `views/partials/footer.ejs`.

## Downloads (admin only)
Admin → Reports → Download: choose All history / This month / This year / a custom range, then **Excel** or **PDF**.
- Excel: Summary, Monthly, Weekly and Transactions sheets. Totals and nets are live formulas. Includes donor names and phones.
- PDF: summary, monthly and weekly tables and the transaction list (the latest 3000 if there are more; Excel always has everything).
- Only COMPLETED transactions are counted in totals; pending and cancelled ones are listed and labelled. Weeks run Saturday to Friday.
- These files contain private donor information. They can only be downloaded while logged in as admin.
- The PDF uses the bundled Noto Sans Bengali font (`fonts/`, SIL Open Font License) so Bengali names print correctly.

## Everyday commands
- `npm test`        runs all automated tests (privacy, totals, reports, the 8 final scenarios)
- `npm run backup`  saves a copy of the database into the `backups` folder
- `npm run seed`    creates the admin, or resets the admin password to the value in `.env`

## Where is my data?
- **On your computer:** in one file, `madrasa.db`. Back it up with `npm run backup`.
- **On the live site:** in your **Turso** database. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` and the app uses it automatically.
  Never run the live site without them: Render's disk is wiped on every deploy, so a local file would start empty each time.
- Back up Turso with:  `turso db shell YOUR-DB-NAME .dump > backup.sql`

## Going live on Render with Turso
1. Push this folder to GitHub and connect it to a Render Web Service (build `npm install`, start `npm start`).
2. In Render → Environment set: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SESSION_SECRET` (20+ random characters), `NODE_ENV=production`, `TRUST_PROXY=1`, `TZ_OFFSET_HOURS=6`, and `NODE_VERSION=22`.
3. First start only ADDS missing tables/columns. It never deletes or rewrites your records, and it refuses to run against a database with an unexpected structure.
4. If your Turso database already has an admin, log in with that admin. If you forgot the password, put the same Turso values in a local `.env` plus a new `ADMIN_EMAIL`/`ADMIN_PASSWORD` and run `npm run seed`.
   If the database has no admin at all, one is created automatically from `ADMIN_EMAIL` and `ADMIN_PASSWORD` on first start.
5. Tip: pick the Render region nearest your Turso region. Every save is a round trip to Turso, so a nearby region is noticeably faster.

## Going live checklist
1. HTTPS only (Render does this for you).
2. A strong, long admin password and a long random `SESSION_SECRET`. Never share the Turso token or these values.
3. Run `npm test` before publishing changes.

## Privacy design
- Every public query lives in `publicData.js`. It picks the display name inside the database query (real name only when PUBLIC, otherwise
  "Anonymous Donor") and never loads phone numbers, notes or admin data.
- `tests/privacy.test.js` and `tests/scenarios.test.js` fail if a phone number, private name or note ever appears on a public page or API.
