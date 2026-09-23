# Steady habit and skill tracker

Steady can run as a local demo, or connect to Supabase for shared workspaces, sign-in, per-member progress, and private task-photo storage. The Supabase integration is prepared but not connected to a project yet. Do not invite family members until the setup below is complete.

## Local demo

Open `index.html` in a browser. Demo records stay in that browser's local storage and are not shared.

## Connect a shared workspace

1. Create a Supabase project and copy its project reference, project URL, and publishable key.
2. In the Supabase SQL editor, run [`supabase/migrations/001_shared_workspace.sql`](supabase/migrations/001_shared_workspace.sql). This creates the workspace, member, task, and progress tables; enables row-level security; and creates a private `task-proofs` bucket. Members can read and edit their own logs. Workspace admins can read members' logs and manage practices.
3. Install the Supabase CLI, open a terminal in this `outputs` folder, then run `supabase login`, `supabase link --project-ref YOUR_PROJECT_REF`, and `supabase functions deploy invite-member`. The invite function uses Supabase Auth to send invitations.
4. Make the service role key available to the invite function with `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY`. Keep this key on the server; never put it in `cloud-config.js` or GitHub.
5. In [`cloud-config.js`](cloud-config.js), set `supabaseUrl` and `publishableKey` from the Supabase project. These browser-safe settings are protected by the database policies.
6. In Supabase Auth URL configuration, allow the eventual GitHub Pages URL as a redirect. Then publish the root of this repository with GitHub Pages.
7. Sign in with your email link. Your first account creates the workspace and becomes its admin. From Admin, invite your brother using his email. He signs in from the email invitation. Use the member selector in the top bar to view his progress.

Photo submissions upload to the private storage bucket and are visible to their owner and workspace admins. AI image verification is not enabled yet: it needs a server-side vision provider and an explicit provider/API-key setup. No submitted photo is currently sent to an AI service.

## Included product behavior

- Add and archive recurring practices from the Admin panel; historical logs remain stored.
- Invite and remove workspace members. Removing membership does not delete the member's account or historical task logs.
- Record binary completion, quantitative results, and friction notes.
- Attach image proof to a task log and mark a submission reviewed.
- Compare rolling completion, quantitative change, and coaching notes.

For authenticated data access, the frontend uses a Supabase publishable key and relies on Postgres row-level security. The Supabase security guide explains why exposed tables need both explicit grants and RLS policies: [Supabase: Secure your data](https://supabase.com/docs/guides/database/secure-data), [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security). Private file access is controlled by Storage policies: [Supabase: Storage access control](https://supabase.com/docs/guides/storage/security/access-control).


## Focus timer

The dashboard includes a task-linked focus timer with a completion reminder. Where supported, it can request browser permission to pause after two minutes of inactivity. Browser pages cannot identify which other desktop application is open (for example, CapCut versus a game); that requires a separately installed desktop companion with operating-system permissions.
