# Invest Calc — release notes for V5.2.3 (persistence, recovery, export/import)

Status of this document: written for the owner's production decision. Nothing in it has been deployed to `investcalc.dev`.

## 1. What production is today (verified 2026-11-16 with `curl`)

`https://investcalc.dev` serves the **original static app** (`index.html`, `app.js`, `style.css`; branch `main`, commit `ed6a898`).
It has **no saved-plans feature**: `app.js` contains no `localStorage`, `sessionStorage` or `indexedDB`. It also sends none of the
security headers from `vercel.json`, and `/robots.txt` and `/sitemap.xml` return 404.

Consequences for the first production release of the React app:

* **There is no existing production user data to migrate.** Saved plans only ever existed in the React builds, which have only been
  served from the preview project (`investcalc-redesign-preview.vercel.app`, a different origin with its own storage).
* The security headers (CSP, `X-Frame-Options`, …), `robots.txt`, `sitemap.xml` and the canonical/Open-Graph metadata of this branch
  will appear on production for the first time. They were verified only on the preview.
* The production Vercel project is **not visible** from the account/CLI scope used here (`vercel project ls` lists only the preview
  project), so its Git integration, production branch, Node version, domain settings and environment variables could not be
  inspected. Check them in the Vercel dashboard before merging (section 5).

## 2. Persistence architecture

| | Before (V5.2.2) | After (V5.2.3) |
|---|---|---|
| Source of truth | `localStorage` key `investcalc.v2.scenarios` | **IndexedDB** database `investcalc`, store `doc`, one record `{rev, raw}` |
| Write rule | read stored text, compare with last-seen text, write (three steps, not atomic; WebKit may serve a stale read) | one **read-write transaction**: read the record, refuse unless `rev` equals the revision this tab last saw, else `put(rev+1)`. The browser serialises such transactions across tabs |
| Conflict | detected only if the read was fresh | detected **inside the transaction**; the later writer is refused and shown the conflict dialog; nothing is overwritten |
| Backups | one `localStorage` array, read-modify-write (two tabs could overwrite each other's backups), 10 entries | add-only IndexedDB store (one record per backup), **typed** (`conflict`, `restore`, `import`, `migration`, `unreadable`, `auto`, `draft`); protected kinds keep 20, routine copies 10, limited separately |
| Cross-tab signal | `storage` event + 2 s check | `BroadcastChannel` + `storage` event on the mirror key + 2 s check; the message is only a hint, the record is always re-read from IndexedDB |
| Unsaved edits | `pagehide` write that may not finish | every edit also writes a **synchronous draft** (`investcalc.v3.draft.<tab>`): a reload of the same tab replays it; a draft written while the tab was closing is finished by any other open tab; other leftovers become `draft` backups |
| Boot | synchronous `localStorage` | first frame from the `investcalc.v3.mirror` copy (written after each successful save), then reconciled with IndexedDB |
| Fallback | – | if IndexedDB is unavailable the same interface runs on `localStorage` (check-and-write under a Web Lock when available). This path is best effort and **not** transactional |

Web Locks (V5.2.1) are no longer part of the primary path: the transaction replaces them.

### Was the race prevented or mitigated?
On the IndexedDB path a lost update between tabs is prevented by the transaction's revision check (a stale writer cannot commit).
That is a property of IndexedDB, exercised by stress runs in Chromium and WebKit (see the report); it is **not** proven for every
browser. On the `localStorage` fallback path it is only mitigated.

## 3. Migration on first visit of a build with this storage

Per origin, on first load:

1. The first frame is painted from `investcalc.v3.mirror` if present, else from the **original key `investcalc.v2.scenarios`** (read only).
2. IndexedDB is opened. If it holds no record, the previous text is copied into a **backup** (`migration`, or `unreadable` if it cannot
   be parsed). If that backup cannot be written, **nothing is migrated or written**, the user sees the save warning, and the original is untouched.
3. The first revision (`rev 1`) is written, then **read back and compared**. Only then is it used. A second tab migrating at the same
   moment simply continues from the other tab's record (the transaction allows exactly one `rev 1`).
4. `investcalc.v2.scenarios` and `investcalc.v2.backups` are **never modified or deleted** by this code. Reloading is idempotent
   (verified: three reloads leave `rev 1` and one migration backup).
5. Malformed or unsupported data is not discarded: it is kept as an `unreadable` backup and listed under *Saved plans → Recover previous version*.

## 4. User-facing recovery

Header → **Saved plans**: *Export plans (JSON)*, *Import plans…*, *Recover previous version…*.

* Export: `investcalc-plans-YYYY-MM-DD.json` with `{format, version, exportedAt, activeId, scenarios}` only.
* Import: size limit 1.5 MB, at most 4 plans, every scenario rebuilt by the same sanitizer as share links, unknown format/newer version refused,
  preview before applying, *Add* or *Replace*; the current plans are backed up first and the change is undoable.
* Recover: lists backups (date, kind, number of plans, names), previews, asks for confirmation, backs up the current plans, restores, verifies by reading back.
* If saving fails, the warning offers *Export plans* so the data can be kept as a file.

Browsers can clear local data; backups are not durable storage.

## 5. Production deployment procedure (owner-run)

Pre-flight (dashboard): production project, Git integration and production branch, Node version (`engines.node >=22.12`), build command
`npm run build`, output `dist`, domain `investcalc.dev`, no environment variables are used by the app.

1. Review PR #1 on `redesign/aurora-v2`. Decide explicitly that production changes from the static page to the React app
   (new URL behaviour: `?s=` share links, `#/retirement` etc. are hash routes; `vercel.json` has no rewrites because routing is hash-based).
2. Merge PR #1 into `main` (owner action). Vercel's Git integration deploys `main`; otherwise deploy from the dashboard.
3. Smoke test on production: load `/` and `/?lang=cs`, edit a plan, reload, *Saved plans → Export*, check `/robots.txt`, `/sitemap.xml`,
   response headers (`curl -I`), and that a CSP violation does not appear in the console.
4. Keep the previous production deployment available for rollback.

## 6. Rollback

* Vercel: *Deployments → previous production deployment → Promote / Instant Rollback* (or redeploy the previous commit). No rebuild is needed.
* Data: production's previous version is the static app, which does not read or write browser storage, so rolling back production **does not
  touch or corrupt** any data the React app saved (it stays in IndexedDB / `localStorage` on that origin and is read again when the React app returns).
* A rollback between two React builds is different: an older React build (≤ V5.2.2) reads only `investcalc.v2.scenarios`, which this build
  never changes, so it shows the plans **as they were at migration time and none of the later edits** (those live in IndexedDB). Ask users to
  *Export plans* before a rollback of that kind, or accept that edits made since the upgrade are invisible (not deleted) until the new build returns.
