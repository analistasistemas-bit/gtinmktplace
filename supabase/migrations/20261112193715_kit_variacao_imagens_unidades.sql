-- ADR-0205: kit_variacao_imagens também guarda a capa do kit vinculado com N unidades (edge gerar-capa-kit-unidades).
--
-- Uma linha é OU de cores (kit com variação, ADR-0200: `cores` e `rotulo` preenchidos, `n` nulo) OU de unidades
-- (ADR-0205: `n` 2..6, `cores` e `rotulo` nulos). Check estrito: nunca as duas coisas, nunca nenhuma.
-- Linhas existentes (todas de cores) continuam válidas.
-- NÃO mudam: trigger de cobrança `kit_variacao_imagens_cobranca` (usa só org_id, request_id e custo_usd), índices
-- únicos (org, request_id, tentativa) e (org, request_id) vivo, RLS sem policy e revoke de anon/authenticated.
-- Índice novo para o teto de 6 tentativas por (org, base, n) a cada 24 h (ADR-0205 §8).
-- Re-executável (`if exists`/`if not exists`); sem begin/commit: o db push já envolve a migration numa transação.

alter table public.kit_variacao_imagens alter column cores drop not null;
alter table public.kit_variacao_imagens alter column rotulo drop not null;
alter table public.kit_variacao_imagens add column if not exists n smallint;

alter table public.kit_variacao_imagens drop constraint if exists kit_variacao_imagens_n_check;
alter table public.kit_variacao_imagens
  add constraint kit_variacao_imagens_n_check check (n is null or n between 2 and 6);

alter table public.kit_variacao_imagens drop constraint if exists kit_variacao_imagens_cores_ou_unidades_check;
alter table public.kit_variacao_imagens
  add constraint kit_variacao_imagens_cores_ou_unidades_check check (
    (n is null and cores is not null and rotulo is not null)
    or (n is not null and cores is null and rotulo is null)
  );

-- Parcial: só linhas de unidades entram no teto; `n = $1` na consulta implica `n is not null`.
create index if not exists kit_variacao_imagens_teto_unidades_idx
  on public.kit_variacao_imagens (org_id, familia_base_id, n, criado_em) where n is not null;

comment on column public.kit_variacao_imagens.n is
  'ADR-0205: quantidade de unidades (2..6) da capa do kit vinculado gerada por IA. Nulo = linha de cores (ADR-0200).';
comment on column public.kit_variacao_imagens.cores is
  'ADR-0200: cores da combinação do kit com variação. Nulo só em linha de unidades (ADR-0205, `n` preenchido).';
comment on column public.kit_variacao_imagens.rotulo is
  'ADR-0200: rótulo da combinação de cores. Nulo só em linha de unidades (ADR-0205, `n` preenchido).';
