-- ADR-0210, Emenda 1: conexão de agente pode valer até ser revogada (expira_em nulo).
-- Com data, o limite de 366 dias continua.
alter table public.agente_conexoes alter column expira_em drop not null;

alter table public.agente_conexoes drop constraint agente_conexoes_expira_check;
alter table public.agente_conexoes add constraint agente_conexoes_expira_check
  check (expira_em is null or (expira_em > criada_em and expira_em <= criada_em + interval '366 days'));

comment on column public.agente_conexoes.expira_em is 'Fim da validade da chave; nulo = vale até ser revogada (ADR-0210, Emenda 1).';
