# Attendly — Student Attendance Management System

A hackathon-ready React + Vite + Supabase starter with Google sign-in and three role-based portals.

## Features

- Google OAuth login through Supabase Auth
- Student portal: subject-wise attendance, percentage, and recorded history
- Teacher portal: choose a subject/date, mark present/absent, save attendance
- Admin portal: view accounts and change portal roles
- Responsive desktop/mobile UI
- PostgreSQL schema with Row Level Security (RLS)
- Unique attendance record per student + subject + date

> This is an MVP starter, not a certified college attendance product. Test all access rules with separate student, teacher, and admin accounts before using real student data.

## 1. Create the Supabase project

1. Create a project at https://supabase.com.
2. Open **SQL Editor → New query**.
3. Copy all of `supabase/schema.sql` into the editor and run it.
4. Open **Project Settings → API** and copy the Project URL and publishable/anon key. Never use the `service_role` key in a browser app.

## 2. Configure Google login

1. In Google Cloud Console, create/select a project.
2. Configure the OAuth consent screen.
3. Create an OAuth client ID for a **Web application**.
4. In Supabase, open **Authentication → Providers → Google**, enable it, and enter the Google Client ID and Client Secret.
5. Add your app's local URL and deployed URL to **Authentication → URL Configuration → Redirect URLs**, for example:
   - `http://localhost:5173/**`
   - `https://YOUR-DEPLOYED-DOMAIN/**`
6. Set the Site URL to your deployed frontend URL.
7. For Google OAuth's authorized redirect URI, use the callback URL shown in Supabase's Google provider settings (normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`).

Google Client Secret belongs in Supabase provider settings only. Do not commit it to GitHub.

## 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
VITE_ADMIN_EMAIL=admin@yourcollege.edu
```

Replace the admin email with the real administrator's email. The email setting changes the frontend display only; database admin permissions require the role update in step 5.

## 4. Run locally

Install Node.js 20 or later, then:

```bash
npm install
npm run dev
```

Open the local URL Vite prints, normally `http://localhost:5173`.

Before publishing, verify the production build:

```bash
npm run build
```

## 5. Create the first admin and add academic data

1. Start the app and sign in with the intended admin Google account once. This creates a `profiles` row with the default `student` role.
2. In Supabase SQL Editor, run (replace the email):

```sql
update public.profiles
set role = 'admin'
where email = 'admin@yourcollege.edu';
```

3. Refresh/re-login to load the admin role.
4. Create a class and teacher/student profiles after the users have signed in. Use Supabase Table Editor or admin SQL to add rows.

Example starter data (run after the relevant users have signed in; replace UUIDs with real `profiles.id` values):

```sql
insert into public.classes (name, section, academic_year)
values ('B.Tech CSE', 'A', '2026-2027')
on conflict (name, section, academic_year) do nothing;

-- Create a teacher row for an existing teacher profile:
-- insert into public.teachers (profile_id, department)
-- values ('TEACHER_PROFILE_UUID', 'CSE');

-- Create a student row for an existing student profile:
-- insert into public.students (profile_id, roll_number, class_id)
-- values ('STUDENT_PROFILE_UUID', 'CSE001', 'CLASS_UUID');

-- Create a subject assigned to that teacher and class:
-- insert into public.subjects (name, code, class_id, teacher_id)
-- values ('C Programming', 'CS203', 'CLASS_UUID', 'TEACHER_UUID');
```

**Important setup note:** Admin management of users and academic records is a minimal MVP. Add dedicated admin forms and validate class/teacher assignments before real deployment. Do not let users set their own roles from a public signup form.

## 6. Deploy with Vercel (recommended)

1. Push this project to a GitHub repository.
2. In Vercel, import that GitHub repository.
3. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
4. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_ADMIN_EMAIL` in Vercel project environment variables.
5. Deploy.
6. Add the Vercel URL to Supabase Auth's Site URL/Redirect URLs and Google OAuth's authorized JavaScript origins as applicable. Keep the Supabase callback URI from the provider settings.
7. Redeploy after environment variable changes.

GitHub Pages can host a static Vite build too, but Vercel is simpler for SPA routes and environment configuration. Supabase remains the backend either way.

## Security notes

- The browser must only contain the Supabase publishable/anon key; never expose `service_role`.
- RLS is the real authorization layer. UI role checks are not security.
- The initial admin must be promoted by a trusted project owner in SQL Editor.
- The sample admin role-change UI is a prototype. It requires adding profile rows and student/teacher detail rows for newly assigned roles.
- Attendance percentage uses recorded sessions: `present / total recorded × 100`. Future or unmarked classes are not counted.
- For a production deployment, add audit logs, controlled corrections, export permissions, backups, and institution policy review.
