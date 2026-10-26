begin;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('fylmer-generated', 'fylmer-generated', false, 104857600,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'application/json'])
on conflict (id) do nothing;
create policy fylmer_generated_read_own on storage.objects for select to authenticated using (
  bucket_id = 'fylmer-generated' and (storage.foldername(name))[1] = auth.uid()::text
);
commit;
