-- ============================================================
-- Novitium Encyclopedia — document cover thumbnails
--
-- Run this ONCE in the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- What it does:
--   1. Adds cover_path / cover_updated_at to the documents table.
--   2. Creates a PUBLIC "covers" bucket for the rendered page-1 images.
--
-- Why the covers bucket is public while "documents" stays private:
-- a cover is a 800px-wide picture of a title page, not the document.
-- Making it public means the library grid loads plain <img> tags that the
-- browser and CDN cache for free -- no signed URL per card, no extra
-- round trips, and no Supabase egress on repeat visits. The actual files
-- in "documents" keep their private bucket and 5-minute signed URLs
-- exactly as they are today.
--
-- If a cover page itself is confidential, leave that row's cover_path
-- NULL and the card falls back to the generated placeholder.
-- ============================================================

-- ---------- 1. columns ----------

alter table public.documents
  add column if not exists cover_path       text,
  add column if not exists cover_updated_at timestamptz;

comment on column public.documents.cover_path is
  'Path inside the public "covers" bucket, e.g. "solar-basics.jpg". '
  'NULL means no cover yet -- the site shows a generated placeholder. '
  'Written by tools/generate-covers.mjs.';

-- Lets the generator find un-covered documents without scanning the table.
create index if not exists documents_cover_pending_idx
  on public.documents (published_on desc)
  where cover_path is null;

-- ---------- 2. the public covers bucket ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'covers',
  'covers',
  true,                                   -- public read
  2 * 1024 * 1024,                        -- 2 MB ceiling; real covers are ~60-120 KB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets still need an explicit SELECT policy for anonymous reads.
drop policy if exists "covers are publicly readable" on storage.objects;
create policy "covers are publicly readable"
  on storage.objects
  for select
  to public
  using (bucket_id = 'covers');

-- Writes are done by the generator with the service-role key, which bypasses
-- RLS -- so there is deliberately NO insert/update/delete policy here.
-- Nobody can overwrite a cover through the anon key.

-- ---------- 3. sanity check ----------

select
  (select count(*) from public.documents)                        as documents_total,
  (select count(*) from public.documents where cover_path is null) as awaiting_cover,
  (select public from storage.buckets where id = 'covers')       as covers_bucket_public;
