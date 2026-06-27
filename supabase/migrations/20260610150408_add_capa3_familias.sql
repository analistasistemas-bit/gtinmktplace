-- 3ª foto comum por família (CAPA3_), espelhando capa2_* (spec 2026-06-10).
alter table familias add column if not exists capa3_storage_path text;
alter table familias add column if not exists capa3_ml_picture_id text;
