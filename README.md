# Transformer Tracking Dashboard (GitHub Pages + Supabase)

```
Excel ──(import_excel.py, on your PC)──►  Supabase (Postgres + Auth)  ◄──(login, live data)── Dashboard on GitHub Pages
```
* **GitHub** hosts only the web page (`web/`). No data is stored there.
* **Supabase** stores all data, users and the audit trail. Row Level Security = only logged-in, active users can read; only editors/admins can change.

## Step 1 – Supabase project (10 min)
1. supabase.com → New project (region: *Mumbai / ap-south-1*). Save the DB password.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → Run.
3. **Authentication → Providers → Email**: keep Email on, **turn OFF "Allow new users to sign up"**.
4. **Authentication → Users → Add user** → create one login per person (email + password, tick *Auto confirm*).
5. Give roles (SQL Editor):
   ```sql
   update profiles set role='admin',  display_name='Ashish' where id=(select id from auth.users where email='you@example.com');
   update profiles set role='editor', workshop='MAU'       where id=(select id from auth.users where email='mau.incharge@example.com');
   -- role: admin (all + delete) | editor (edit; workshop optional = only that workshop) | viewer (read only, default)
   ```
6. **Project Settings → API**: copy **Project URL**, **anon public** key, and **service_role** key (secret!).

## Step 2 – Load your Excel data (once, from your PC)
```bash
pip install -r scripts/requirements.txt
python scripts/import_excel.py TRACKING_OF_TRANSFORMERs_12.xlsx --dry-run   # creates import_preview.csv – check it
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_KEY="service_role key"      # Windows PowerShell: $env:SUPABASE_URL="..."
python scripts/import_excel.py TRACKING_OF_TRANSFORMERs_12.xlsx
```
Reads all monthly sheets (Jan→Nov 2026), skips summary/daily/PR SEARCH sheets, maps the changing column layouts by header name, and upserts on **PR No** (re-running never duplicates). Tested on your file: **14,383 unique PRs** (Azamgarh 6,998 · Ballia 5,018 · Mau 2,367).
Your old `Users` sheet had plain-text passwords – don't import it; use Supabase Auth (Step 1.4).

## Step 3 – Publish on GitHub
1. Edit `web/config.js`: paste Project URL + **anon** key (safe to publish; RLS protects data).
2. Create a GitHub repo, push this folder:
   ```bash
   git init && git add . && git commit -m "Transformer dashboard"
   git branch -M main && git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main
   ```
3. Repo → **Settings → Pages → Source: GitHub Actions**. The workflow `.github/workflows/pages.yml` deploys `web/`.
4. Open `https://<you>.github.io/<repo>/` → sign in.
5. Supabase → **Authentication → URL Configuration** → set Site URL to that address.

## Daily use
* **Overview**: KPIs, workshop/division summary, capacity-wise PR, stage pipeline, monthly trend, top causes (same logic as your SUMMARY sheets; filter by PR date).
* **Records**: search/filter, click a row to update dates (issue → replacement → return → DTC → repair → test → kitty → re-issue), **+ New PR**, **Export CSV**.
* Every edit is saved in `case_history` (who, when, old/new values) – useful for enquiries.
* Stage is computed automatically from which dates are filled.

## Notes
* Never commit the service_role key or the .xlsx (`.gitignore` already excludes them).
* Free Supabase projects pause after 7 days idle – open the dashboard weekly or upgrade.
* Backup: Supabase → Database → Backups, or use the dashboard's Export CSV.
* Next steps if wanted: monthly summary snapshot table, daily bulk-entry page replacing the 01.11.2026-style sheets, driver master & call-log screens (tables `call_logs` already exist).
