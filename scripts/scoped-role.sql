-- Scoped DB role for the deployed Studio service (Coolify, studio.freshcontext.ai).
--
-- Goal: the deployed service should NOT hold the master service_role key (which
-- bypasses all RLS on every table in contextListener — including notes,
-- vault_embeddings, primary_source_inbox, radar_*, everything). This role can
-- read/write exactly the studio_* tables + the one cross-project read Studio
-- actually needs (brandVoiceNotes() in src/db.js reads `notes`), and NOTHING
-- else. Deny-by-default: a fresh Postgres role has no privileges except what
-- is granted below, so studio_service literally cannot see radar_signals,
-- primary_source_inbox, vault_embeddings, etc. Modeled on
-- fresh-context/radar/scoped-role.sql (the isolation pattern this repo was
-- told to copy — see the app-estate-architecture plan, step A2).
--
-- PREREQUISITE — not yet true as of this writing: this script is prepared but
-- NOT applied. It's scoped to run only after A1 (Studio actually deployed and
-- reachable at studio.freshcontext.ai) is verified — applying it against a
-- key still in active local-dev use would just break local dev with no
-- production benefit yet.
--
-- KNOWN GAP: studio_feedback and studio_brand_rules (see src/db.js — the
-- Feedback tab and Voice & Tone tab) have no checked-in migration in this
-- repo's history (fresh-context/local-server/supabase/migrations/); they were
-- evidently created ad hoc against contextListener. This script grants +
-- policies them anyway (their names are stable, referenced directly in
-- src/db.js), and `alter table … enable row level security` is idempotent —
-- safe whether or not RLS was already on. But verify both tables actually
-- exist with these exact columns before running in a fresh environment.
--
-- Run in the contextListener SQL editor. Idempotent. Safe to re-run.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'studio_service') then
    create role studio_service nologin noinherit;
  end if;
end $$;

-- let PostgREST switch into this role when a JWT carries role=studio_service
grant studio_service to authenticator;

grant usage on schema public to studio_service;

-- ── studio_* — full CRUD scoped to Studio's own tables ──────────────────────
grant select, insert, update, delete on public.studio_tools            to studio_service;
grant select, insert, update, delete on public.studio_jobs             to studio_service;
grant select, insert, update, delete on public.studio_assets           to studio_service;
grant select, insert, update         on public.studio_taxonomy         to studio_service;
grant select, insert, update, delete on public.studio_asset_embeddings to studio_service;
grant select, insert, update         on public.studio_feedback         to studio_service;
grant select, insert, delete         on public.studio_brand_rules      to studio_service;  -- replaceBrandRules() is delete-all + insert, never update

-- match_studio_assets() is the semantic-search RPC (GET /api/assets?q=).
grant execute on function public.match_studio_assets(vector, int, jsonb) to studio_service;

-- brandVoiceNotes() (src/db.js) is Studio's one cross-project read: the Voice
-- & Tone tab pulls curated notes from the shared vault `notes` table. Grant
-- read-only, and back it with a policy narrower than the app-level filter it
-- duplicates (defense in depth: even if src/db.js's `audience !== 'internal'`
-- filter is ever dropped, the DB itself still won't return internal notes to
-- this role).
grant select on public.notes to studio_service;

-- Deliberately NOT granted: vault_embeddings, links, primary_source_inbox,
-- radar_*, research_sources, and everything else. studio_service cannot touch
-- them.

-- Every table below has RLS enabled with no existing policy → service_role-only
-- (see fresh-context/local-server/supabase/migrations/20260710150000_studio_state.sql
-- and 20260711120000_studio_generalize.sql). A non-bypass role needs a matching
-- policy per table or its grants above are silently inert.
alter table public.studio_tools            enable row level security;
alter table public.studio_jobs             enable row level security;
alter table public.studio_assets           enable row level security;
alter table public.studio_taxonomy         enable row level security;
alter table public.studio_asset_embeddings enable row level security;
alter table public.studio_feedback         enable row level security;
alter table public.studio_brand_rules      enable row level security;
-- notes already has RLS enabled (20260519060000_notes_and_links.sql); only
-- adding a policy below, not touching its existing grants/policies for other
-- roles (e.g. the vault MCP's own access).

drop policy if exists studio_service_all_tools on public.studio_tools;
create policy studio_service_all_tools on public.studio_tools
  for all to studio_service using (true) with check (true);

drop policy if exists studio_service_all_jobs on public.studio_jobs;
create policy studio_service_all_jobs on public.studio_jobs
  for all to studio_service using (true) with check (true);

drop policy if exists studio_service_all_assets on public.studio_assets;
create policy studio_service_all_assets on public.studio_assets
  for all to studio_service using (true) with check (true);

drop policy if exists studio_service_all_taxonomy on public.studio_taxonomy;
create policy studio_service_all_taxonomy on public.studio_taxonomy
  for all to studio_service using (true) with check (true);

drop policy if exists studio_service_all_embeddings on public.studio_asset_embeddings;
create policy studio_service_all_embeddings on public.studio_asset_embeddings
  for all to studio_service using (true) with check (true);

drop policy if exists studio_service_all_feedback on public.studio_feedback;
create policy studio_service_all_feedback on public.studio_feedback
  for all to studio_service using (true) with check (true);

drop policy if exists studio_service_all_brand_rules on public.studio_brand_rules;
create policy studio_service_all_brand_rules on public.studio_brand_rules
  for all to studio_service using (true) with check (true);

drop policy if exists studio_service_select_notes on public.notes;
create policy studio_service_select_notes on public.notes
  for select to studio_service using (coalesce(audience, '') <> 'internal');
