# Meridian - Attendance

Face-recognition attendance with **two portals**:

| Portal | Who | What they can do |
|---|---|---|
| **Platform admin** `/admin` | you | create companies, give each its own login, enable/disable them, add demo data, see live check-ins, get the tablet link + QR code |
| **Company** `/c` | the company | **Verify** (camera screen for the tablet), **Participants** (add people with name/details + camera enrolment), **Attendance** (live log, absent list, CSV), **Settings** |

The kiosk (**Verify**) shows a live camera with a face frame: it turns green and shows the person's name and a time-in or time-out stamp on success, and red when the face is unknown. Each person can have their own allocated time in/out, and check-ins and check-outs can be sent to WhatsApp groups through n8n.

## Run it (exhibition laptop)

You need **Node.js 20.19+ or 22** (https://nodejs.org). Then, in this folder:

```bash
npm install          # once - also copies the face models, works offline afterwards
npm run db:embedded  # terminal 1 - starts a PostgreSQL server (no install needed). Keep it open.
npm run build        # once (and after changing the code)
npm start            # terminal 2 - starts the app
```

Windows shortcut: double-click **`start-demo.bat`** (does all of the above).

`npm start` prints the addresses. Open the **“Tablet on same Wi-Fi”** address (`https://192.168.x.x:4443`) on the company
tablet. The first time, the browser warns about the certificate - tap **Advanced -> Proceed**. (HTTPS is required for the
camera on tablets; `http://localhost:4000` works on the laptop itself.)

**Logins**

| | Email | Password |
|---|---|---|
| Platform admin (you) | `admin@meridian.local` | `admin123` |
| Demo company (after `npm run seed`) | `demo@company.com` | `demo123` |

Change the admin login **before the first start** by copying `.env.example` to `.env` and editing it.

### Use your own PostgreSQL instead

Create nothing by hand - the app creates the database and tables itself. Put the connection string in `.env`:

```
DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/meridian
```

or run `docker compose up -d` (a ready `docker-compose.yml` is included).

## Demo-day flow

1. Laptop: sign in at `http://localhost:4000` as platform admin -> **New company** -> copy the sign-in details.
2. Tablet: open the tablet link (scan the QR code on the dashboard), sign in as the company.
3. **Participants -> Add participant**: type name/details, press the **camera icon (“Enrol face”)**, take 3 photos, tick consent, save.
4. **Verify** (camera icon in the top bar): step up, blink once -> “Welcome, <name>”.
5. Laptop dashboard shows every scan live. **Attendance** page has the late / absent lists and a CSV export.
6. Want the screens to look busy? Use **+100** (100 placeholder participants) and **Simulate day** on the company row.
   Simulated rows are labelled *demo data*. **Reset attendance** clears everything before the next visitor.

## How recognition works

1. **Tracking (fast, every frame):** Google MediaPipe BlazeFace finds and follows the face and drives the scope.
2. **Recognition (when someone stands still):** `@vladmandic/face-api` turns the face into 128 numbers (a *descriptor*).
   Photos are never sent for matching - only that list of numbers.
3. **Matching (server):** the descriptor is compared with that company's enrolled people. Distance < 0.5 (adjustable in
   Settings) = match. If two people are almost equally close, it refuses to guess.
4. **Liveness:** before matching, the person must **blink** (eye-aspect-ratio from 68 face landmarks). A photo held up to
   the camera never blinks. This stops the easy attack but a *pre-recorded video* of someone blinking could still fool it.
5. Each person is enrolled with **3 samples** (different head angles), which is much more reliable than one photo.

Stack: React 19 + Vite, Express 5, PostgreSQL (`pg`), JWT logins (bcrypt), self-signed HTTPS for the tablet.

## Privacy

Faces are biometric data. The app stores 128-number descriptors plus one small 128 px thumbnail (for the “Welcome” card),
asks for a **consent tick** at enrolment, and offers **Remove face data** per person and **Delete company** for everything.
At an exhibition, tell visitors what is stored and use **Reset / Delete** afterwards.

## Develop

```bash
npm run db:embedded   # database
npm run dev           # API on :4000 + web app on :5173 (hot reload)
npm run test:api      # 55 API checks (needs the server running on :4000)
node scripts/test-blink.mjs   # blink-detector unit test
```

```
server/            Express API  (auth, admin, company, matching, HTTPS, embedded DB, seed)
src/engine/        camera hook, MediaPipe tracker, face-api recognition, blink liveness, scope renderer
src/pages/admin/   platform-admin portal
src/pages/company/ Verify, Participants, Attendance, Settings
src/components/    enrol-camera modal, UI kit, icons
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Tablet says the camera needs a secure page | Use the **https://…:4443** address, not `http://…:4000` |
| Certificate warning on the tablet | Normal (self-signed). Advanced -> Proceed. Once per tablet |
| “PostgreSQL is not reachable” | Start `npm run db:embedded`, or fix `DATABASE_URL` in `.env` |
| Tablet can't reach the laptop | Same Wi-Fi/hotspot; allow Node.js through the Windows firewall (private networks) |
| “Face models failed to load” | Run `npm install` again (copies the models into `public/models`) |
| Someone is not recognised | Re-enrol in good light, face the camera; loosen strictness in Settings (0.50 -> 0.55) |
| Port in use | Set `PORT` / `HTTPS_PORT` in `.env` |

## WhatsApp messages (n8n + bridge)
`whatsapp-bridge/` is a small program that keeps your own WhatsApp logged in and sends the messages n8n gives it, to groups too.
See `whatsapp-bridge/README.md`. Import `docs/n8n-attendance-workflow.json` into n8n, publish it, and put its Production URL into Meridian > Settings.
