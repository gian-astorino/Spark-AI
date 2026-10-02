-- The chat takes text and Word files too (price lists, call transcripts).
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
where id = 'uploads';
