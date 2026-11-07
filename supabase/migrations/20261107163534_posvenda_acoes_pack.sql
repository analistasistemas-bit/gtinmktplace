-- Anexo nas mensagens pós-venda: ml_posvenda_acoes aceita tentativa por pack.
-- Idempotente. Alvo da tentativa = claim_id XOR pack_id.
alter table public.ml_posvenda_acoes alter column claim_id drop not null;
alter table public.ml_posvenda_acoes add column if not exists pack_id text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ml_posvenda_acoes_alvo_check') then
    alter table public.ml_posvenda_acoes add constraint ml_posvenda_acoes_alvo_check
      check (num_nonnulls(claim_id, pack_id) = 1);
  end if;
end $$;
