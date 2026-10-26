insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fylmer-media', 'fylmer-media', false, 104857600,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg'])
on conflict (id) do nothing;
create policy fylmer_media_read on storage.objects for select to authenticated using (
  bucket_id = 'fylmer-media' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy fylmer_media_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'fylmer-media' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy fylmer_media_delete on storage.objects for delete to authenticated using (
  bucket_id = 'fylmer-media' and (storage.foldername(name))[1] = auth.uid()::text
);
