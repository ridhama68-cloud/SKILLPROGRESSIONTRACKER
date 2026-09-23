-- Shared workspace foundation for Steady.
-- Run this once in the Supabase SQL editor before enabling the cloud client.
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  category text not null default 'Other',
  frequency text not null default 'Daily',
  track_type text not null default 'binary' check (track_type in ('binary','quantitative')),
  unit text not null default '',
  direction text not null default 'up' check (direction in ('up','down')),
  target text not null default '',
  created_on date not null default current_date,
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.task_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null default current_date,
  done boolean not null default false,
  value numeric,
  friction text not null default '',
  photo_path text,
  photo_reviewed boolean not null default false,
  ai_result text not null default 'not_checked' check (ai_result in ('not_checked','matched','uncertain','not_matched')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, user_id, log_date)
);

create index if not exists task_logs_member_date_idx on public.task_logs (workspace_id, user_id, log_date desc);
create index if not exists tasks_workspace_idx on public.tasks (workspace_id, created_on);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_workspace_admin(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;

create or replace function public.create_workspace(workspace_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.workspaces(name, created_by)
    values (coalesce(nullif(trim(workspace_name), ''), 'My workspace'), auth.uid())
    returning id into new_id;
  insert into public.workspace_members(workspace_id, user_id, display_name, role)
    values (new_id, auth.uid(), coalesce(auth.jwt()->'user_metadata'->>'full_name', ''), 'admin');
  return new_id;
end;
$$;

create or replace function public.touch_task_log()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists task_logs_touch_updated_at on public.task_logs;
create trigger task_logs_touch_updated_at before update on public.task_logs
for each row execute function public.touch_task_log();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_logs enable row level security;

revoke all on public.workspaces, public.workspace_members, public.tasks, public.task_logs from anon;
grant select on public.workspaces to authenticated;
grant select, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_logs to authenticated;

drop policy if exists "Members can read their workspaces" on public.workspaces;
create policy "Members can read their workspaces" on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

drop policy if exists "Members can see workspace roster" on public.workspace_members;
create policy "Members can see workspace roster" on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "Admins can update workspace roster" on public.workspace_members;
create policy "Admins can update workspace roster" on public.workspace_members for update to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
drop policy if exists "Admins can remove workspace members" on public.workspace_members;
create policy "Admins can remove workspace members" on public.workspace_members for delete to authenticated
  using (public.is_workspace_admin(workspace_id) and user_id <> (select auth.uid()) and role = 'member');

drop policy if exists "Members can read workspace tasks" on public.tasks;
create policy "Members can read workspace tasks" on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "Admins can create workspace tasks" on public.tasks;
create policy "Admins can create workspace tasks" on public.tasks for insert to authenticated
  with check (public.is_workspace_admin(workspace_id) and created_by = (select auth.uid()));
drop policy if exists "Admins can edit workspace tasks" on public.tasks;
create policy "Admins can edit workspace tasks" on public.tasks for update to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
drop policy if exists "Admins can delete workspace tasks" on public.tasks;
create policy "Admins can delete workspace tasks" on public.tasks for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

drop policy if exists "Members can read own logs and admins can read all" on public.task_logs;
create policy "Members can read own logs and admins can read all" on public.task_logs for select to authenticated
  using (public.is_workspace_member(workspace_id) and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id)));
drop policy if exists "Members can create their own logs" on public.task_logs;
create policy "Members can create their own logs" on public.task_logs for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and user_id = (select auth.uid()) and exists (
    select 1 from public.tasks t where t.id = task_logs.task_id and t.workspace_id = task_logs.workspace_id
  ));
drop policy if exists "Members can update their own logs" on public.task_logs;
create policy "Members can update their own logs" on public.task_logs for update to authenticated
  using (public.is_workspace_member(workspace_id) and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id)))
  with check (public.is_workspace_member(workspace_id) and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id)));
drop policy if exists "Members can delete own logs and admins can delete all" on public.task_logs;
create policy "Members can delete own logs and admins can delete all" on public.task_logs for delete to authenticated
  using (public.is_workspace_member(workspace_id) and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-proofs', 'task-proofs', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "Members upload their own task proof" on storage.objects;
create policy "Members upload their own task proof" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-proofs' and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists "Members read permitted task proofs" on storage.objects;
create policy "Members read permitted task proofs" on storage.objects for select to authenticated
  using (
    bucket_id = 'task-proofs' and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2] = (select auth.uid())::text
      or public.is_workspace_admin(((storage.foldername(name))[1])::uuid))
  );
drop policy if exists "Members delete permitted task proofs" on storage.objects;
create policy "Members delete permitted task proofs" on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-proofs' and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2] = (select auth.uid())::text
      or public.is_workspace_admin(((storage.foldername(name))[1])::uuid))
  );

revoke all on function public.create_workspace(text) from public, anon;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_admin(uuid) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
