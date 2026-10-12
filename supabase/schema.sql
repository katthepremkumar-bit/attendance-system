-- Attendly: Student Attendance Management System
-- Run this complete script in Supabase SQL Editor.
-- IMPORTANT: roles are not user-editable by ordinary users. Promote the first admin manually
-- using the SQL at the end, after that account has signed in at least once.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('student', 'teacher', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attendance_status as enum ('present', 'absent');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null unique,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  section text not null default 'A',
  academic_year text not null default '2026-2027',
  created_at timestamptz not null default now(),
  unique(name, section, academic_year)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  roll_number text not null unique,
  class_id uuid references public.classes(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  department text,
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  class_id uuid references public.classes(id) on delete cascade,
  teacher_id uuid references public.teachers(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  attendance_date date not null,
  status public.attendance_status not null,
  marked_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, subject_id, attendance_date)
);

create index if not exists idx_students_class on public.students(class_id);
create index if not exists idx_subjects_class on public.subjects(class_id);
create index if not exists idx_subjects_teacher on public.subjects(teacher_id);
create index if not exists idx_attendance_student_subject_date on public.attendance(student_id, subject_id, attendance_date);
create index if not exists idx_attendance_date on public.attendance(attendance_date);

-- Keep profile creation in the database. Role is always student initially.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    lower(new.email),
    'student'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.set_attendance_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists attendance_updated_at on public.attendance;
create trigger attendance_updated_at before update on public.attendance
for each row execute procedure public.set_attendance_updated_at();

-- Helper functions are SECURITY DEFINER to avoid RLS recursion.
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create or replace function public.is_assigned_teacher_for_subject(subject_uuid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subjects s
    join public.teachers t on t.id = s.teacher_id
    join public.profiles p on p.id = t.profile_id
    where s.id = subject_uuid and p.id = (select auth.uid())
  )
$$;

create or replace function public.is_student_in_my_class(student_uuid uuid, subject_uuid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.students st
    join public.subjects su on su.class_id = st.class_id
    where st.id = student_uuid and su.id = subject_uuid
  )
$$;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.teachers enable row level security;
alter table public.subjects enable row level security;
alter table public.attendance enable row level security;

-- Profiles: users can read their own profile. Admin can see/manage all.
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles
for select to authenticated using (id = (select auth.uid()) or public.is_admin());

-- Users can update their own name only, never their role/email via this policy.
-- Role/email updates are admin-only.
drop policy if exists "profiles_update_self_name" on public.profiles;
create policy "profiles_update_self_name" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()) and role = (select role from public.profiles p where p.id = (select auth.uid())) and email = (select email from public.profiles p where p.id = (select auth.uid())));
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert" on public.profiles
for insert to authenticated with check (public.is_admin());

-- Classes and academic configuration are visible to signed-in users; admin manages them.
drop policy if exists "classes_read_authenticated" on public.classes;
create policy "classes_read_authenticated" on public.classes for select to authenticated using (true);
drop policy if exists "classes_admin_all" on public.classes;
create policy "classes_admin_all" on public.classes for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "students_select_self_teacher_admin" on public.students;
create policy "students_select_self_teacher_admin" on public.students
for select to authenticated using (
  profile_id = (select auth.uid()) or public.is_admin() or exists (
    select 1 from public.subjects su
    join public.teachers t on t.id = su.teacher_id
    where su.class_id = students.class_id and t.profile_id = (select auth.uid())
  )
);
drop policy if exists "students_admin_all" on public.students;
create policy "students_admin_all" on public.students for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "teachers_select_self_or_admin" on public.teachers;
create policy "teachers_select_self_or_admin" on public.teachers for select to authenticated
using (profile_id = (select auth.uid()) or public.is_admin() or public.current_app_role() = 'teacher');
drop policy if exists "teachers_admin_all" on public.teachers;
create policy "teachers_admin_all" on public.teachers for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "subjects_read_authenticated" on public.subjects;
create policy "subjects_read_authenticated" on public.subjects for select to authenticated using (true);
drop policy if exists "subjects_admin_all" on public.subjects;
create policy "subjects_admin_all" on public.subjects for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Attendance visibility: student sees own; teacher sees records for assigned subjects; admin sees all.
drop policy if exists "attendance_select_scoped" on public.attendance;
create policy "attendance_select_scoped" on public.attendance for select to authenticated
using (
  public.is_admin()
  or exists (select 1 from public.students st where st.id = attendance.student_id and st.profile_id = (select auth.uid()))
  or public.is_assigned_teacher_for_subject(attendance.subject_id)
);

-- Only assigned teachers can insert/update attendance for their assigned subject and class.
drop policy if exists "attendance_teacher_insert" on public.attendance;
create policy "attendance_teacher_insert" on public.attendance for insert to authenticated
with check (
  public.is_admin()
  or (public.is_assigned_teacher_for_subject(subject_id)
      and public.is_student_in_my_class(student_id, subject_id)
      and marked_by = (select auth.uid()))
);

drop policy if exists "attendance_teacher_update" on public.attendance;
create policy "attendance_teacher_update" on public.attendance for update to authenticated
using (public.is_admin() or public.is_assigned_teacher_for_subject(subject_id))
with check (
  public.is_admin()
  or (public.is_assigned_teacher_for_subject(subject_id)
      and public.is_student_in_my_class(student_id, subject_id)
      and marked_by = (select auth.uid()))
);

drop policy if exists "attendance_admin_delete" on public.attendance;
create policy "attendance_admin_delete" on public.attendance for delete to authenticated using (public.is_admin());

-- First-admin setup: sign in with the intended admin Google account once, then replace
-- the email below and run this statement as project owner in SQL Editor.
-- update public.profiles set role = 'admin' where email = 'admin@yourcollege.edu';

-- Attendance percentage formula:
-- 100 * count(*) FILTER (WHERE status='present') / nullif(count(*),0)
-- Count recorded attendance sessions only; do not count future/unmarked classes.
