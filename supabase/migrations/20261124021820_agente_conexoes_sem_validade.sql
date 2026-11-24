-- ADR-0210, Emenda 1: conexão de agente pode valer até ser revogada (expira_em nulo).
-- O check `agente_conexoes_expira_check` (data > criação e ≤ 366 dias) não muda: com nulo ele não reprova,
-- então só a obrigatoriedade sai (sem recriar o check nem varrer a tabela).
alter table public.agente_conexoes alter column expira_em drop not null;

comment on column public.agente_conexoes.expira_em is 'Fim da validade da chave; nulo = vale até ser revogada (ADR-0210, Emenda 1).';
