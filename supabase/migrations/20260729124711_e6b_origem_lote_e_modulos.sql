-- E6b (ADR-0094) — Bloco B, Task 1.
-- Duas colunas aditivas: origem do lote (planilha vs cadastro manual) e módulos pagos por org.

-- ----------------------------------------------------------------------------
-- D-2: distinguir lote de planilha de lote de cadastro manual.
-- O default 'planilha' backfilla TODO lote histórico como planilha — correto e
-- intencional: até esta migration, planilha era a única origem possível.
-- ----------------------------------------------------------------------------
alter table public.lotes
  add column origem text not null default 'planilha'
  check (origem in ('planilha', 'manual'));

-- D-1.1: o cadastro reusa o lote manual ABERTO da org em vez de abrir um lote por produto.
-- O predicado espelha EXATAMENTE a query de reuso da edge `cadastrar-produto`; mudar um
-- lado sem o outro só torna o índice inútil (a query continua correta, fica sequencial).
create index lotes_org_manual_aberto_idx
  on public.lotes (org_id, criado_em desc)
  where origem = 'manual' and status in ('importando', 'processando', 'revisao');

-- ----------------------------------------------------------------------------
-- D-13: módulos pagos habilitados por org pelo super-admin.
-- Default '{}' = nenhum módulo; habilitar é sempre ato explícito.
-- ----------------------------------------------------------------------------
alter table public.organizations
  add column modulos_habilitados text[] not null default '{}';

-- Leitura estreita dos módulos da PRÓPRIA org (evita abrir SELECT em organizations).
-- Espelha canais_habilitados_da_org() (20260715014055). Sem parâmetro de propósito:
-- não existe caminho para ler os módulos de outra org.
create or replace function public.modulos_habilitados_da_org()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(modulos_habilitados, '{}')
  from public.organizations
  where id = public.current_org_id()
$$;
revoke all on function public.modulos_habilitados_da_org() from public;
grant execute on function public.modulos_habilitados_da_org() to authenticated;
