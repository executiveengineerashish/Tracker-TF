-- =====================================================================
-- Transformer Tracking – Supabase schema   (run once in SQL Editor)
-- =====================================================================

-- 1) Main table: one row per PR (failed transformer case) -------------
create table if not exists public.transformer_cases (
  id                 bigint generated always as identity primary key,
  pr_no              text unique not null,
  workshop           text not null,                 -- AZAMGARH / MAU / BALLIA
  division           text, subdivision text, substation text, feeder text,
  date_of_damage     date, place_of_damage text, did_no text, capacity_kva int,
  complain_no        text, complain_date date, pr_date date,
  je_name            text, je_mobile text,
  issued_to_firm     text, issue_date date,
  driver_name        text, driver_mobile text,
  replacement_date   date, tx_return_date date,
  observation_dtc    text, cause_of_damage text, ht_protection text, lt_protection text,
  dtc_number         text, dtc_date date,
  repair_firm        text, repair_issue_date date, job_number text,
  repaired_date      date, testing_date date, kitty_date date, reissue_date date,
  reissue_location   text, reissue_feeder text, reissue_substation text, reissue_division text,
  source_sheet       text,
  remarks            text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  updated_by         text
);
create index if not exists tc_workshop_idx on public.transformer_cases (workshop);
create index if not exists tc_prdate_idx   on public.transformer_cases (pr_date);
create index if not exists tc_did_idx      on public.transformer_cases (did_no);
create index if not exists tc_cap_idx      on public.transformer_cases (capacity_kva);

-- 2) Users (replaces the plain-text "Users" sheet – passwords live in Supabase Auth, hashed)
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'viewer' check (role in ('admin','editor','viewer')),
  workshop     text,                       -- optional: restrict an editor to one workshop
  active       boolean not null default true
);

-- 3) Audit trail (who changed what, when) -----------------------------
create table if not exists public.case_history (
  id         bigint generated always as identity primary key,
  case_id    bigint, pr_no text,
  changed_by text, changed_at timestamptz default now(),
  old_row    jsonb, new_row jsonb
);

-- 4) Call log (replaces "Calllogs" sheet) ------------------------------
create table if not exists public.call_logs (
  id bigint generated always as identity primary key,
  workshop text, contact_type text, name text, mobile text, call_status text,
  called_at timestamptz default now(), logged_by text
);

-- 5) Helper functions --------------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() and active $$;

create or replace function public.my_workshop() returns text
language sql stable security definer set search_path = public as
$$ select workshop from public.profiles where id = auth.uid() and active $$;

-- auto-create profile (viewer) when a user is added
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- audit + timestamps
create or replace function public.log_case_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(auth.jwt()->>'email', current_user);
begin
  new.updated_at := now(); new.updated_by := who;
  if tg_op = 'UPDATE' and auth.uid() is not null then
    insert into public.case_history(case_id, pr_no, changed_by, old_row, new_row)
    values (old.id, old.pr_no, who, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists trg_case_change on public.transformer_cases;
create trigger trg_case_change before update on public.transformer_cases
  for each row execute function public.log_case_change();

-- 6) Row Level Security -----------------------------------------------
alter table public.transformer_cases enable row level security;
alter table public.profiles          enable row level security;
alter table public.case_history      enable row level security;
alter table public.call_logs         enable row level security;

create policy "read cases"    on public.transformer_cases for select to authenticated using (public.my_role() is not null);
create policy "insert cases"  on public.transformer_cases for insert to authenticated
  with check (public.my_role() in ('admin','editor') and (public.my_workshop() is null or workshop = public.my_workshop()));
create policy "update cases"  on public.transformer_cases for update to authenticated
  using      (public.my_role() in ('admin','editor') and (public.my_workshop() is null or workshop = public.my_workshop()))
  with check (public.my_role() in ('admin','editor') and (public.my_workshop() is null or workshop = public.my_workshop()));
create policy "delete cases"  on public.transformer_cases for delete to authenticated using (public.my_role() = 'admin');

create policy "own profile"   on public.profiles for select to authenticated using (id = auth.uid() or public.my_role() = 'admin');
create policy "admin profile" on public.profiles for update to authenticated using (public.my_role() = 'admin');

create policy "read history"  on public.case_history for select to authenticated using (public.my_role() is not null);
create policy "read calls"    on public.call_logs for select to authenticated using (public.my_role() is not null);
create policy "add calls"     on public.call_logs for insert to authenticated with check (public.my_role() in ('admin','editor'));

-- 7) View with computed pipeline stage -------------------------------
create or replace view public.cases_v with (security_invoker = true) as
select c.*,
  case
    when reissue_date     is not null then '9 Re-issued'
    when kitty_date       is not null then '8 In kitty (ready)'
    when testing_date     is not null then '7 Tested'
    when repaired_date    is not null then '6 Repaired'
    when repair_issue_date is not null or job_number is not null then '5 Under repair'
    when tx_return_date   is not null or dtc_date is not null then '4 Returned to workshop'
    when replacement_date is not null then '3 Replaced (damaged TX not returned)'
    when issue_date       is not null then '2 Issued, replacement pending'
    else '1 PR received, issue pending'
  end as stage,
  (issue_date is null)                                  as pending_issue,
  (issue_date is not null and replacement_date is null) as pending_replacement,
  case when replacement_date is not null and pr_date is not null then replacement_date - pr_date end as days_to_replace
from public.transformer_cases c;

-- 8) Dashboard numbers in ONE call (same logic as your SUMMARY sheets) --
create or replace function public.dashboard_stats(p_from date default null, p_to date default null)
returns jsonb language sql stable security invoker as $$
with b as (
  select * from public.cases_v
  where (p_from is null or pr_date >= p_from) and (p_to is null or pr_date <= p_to)
)
select jsonb_build_object(
  'totals', (select jsonb_build_object(
      'pr', count(*), 'issued', count(issue_date), 'replaced', count(replacement_date),
      'pending_issue', count(*) filter (where pending_issue),
      'pending_replacement', count(*) filter (where pending_replacement),
      'returned', count(tx_return_date), 'repaired', count(repaired_date),
      'kitty', count(kitty_date), 'reissued', count(reissue_date),
      'avg_days_to_replace', round(avg(days_to_replace)::numeric, 1)) from b),
  'by_workshop', (select coalesce(jsonb_agg(x order by workshop),'[]') from (
      select workshop, count(*) pr, count(issue_date) issued, count(replacement_date) replaced,
             count(*) filter (where pending_issue) pending_issue,
             count(*) filter (where pending_replacement) pending_replacement,
             count(repaired_date) repaired, count(kitty_date) kitty
      from b group by workshop) x),
  'by_division', (select coalesce(jsonb_agg(x order by workshop, division),'[]') from (
      select workshop, division, count(*) pr, count(issue_date) issued, count(replacement_date) replaced,
             count(*) filter (where pending_issue) pending_issue,
             count(*) filter (where pending_replacement) pending_replacement
      from b group by workshop, division) x),
  'by_capacity', (select coalesce(jsonb_agg(x order by capacity_kva),'[]') from (
      select capacity_kva,
             count(*) filter (where workshop='AZAMGARH') azamgarh,
             count(*) filter (where workshop='MAU') mau,
             count(*) filter (where workshop='BALLIA') ballia, count(*) total
      from b where capacity_kva is not null group by capacity_kva) x),
  'by_stage', (select coalesce(jsonb_agg(x order by stage),'[]') from (
      select stage, count(*) n from b group by stage) x),
  'by_month', (select coalesce(jsonb_agg(x order by m),'[]') from (
      select to_char(date_trunc('month', pr_date),'YYYY-MM') m, count(*) pr,
             count(replacement_date) replaced
      from b where pr_date is not null group by 1) x),
  'by_cause', (select coalesce(jsonb_agg(x),'[]') from (
      select cause_of_damage cause, count(*) n from b
      where cause_of_damage is not null group by 1 order by 2 desc limit 10) x)
);
$$;
grant execute on function public.dashboard_stats(date,date) to authenticated;
grant execute on function public.my_role() to authenticated;
