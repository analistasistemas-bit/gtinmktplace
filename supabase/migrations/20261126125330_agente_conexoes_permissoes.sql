-- ADR-0210, Emenda 6: permissões por chave de agente (quais ferramentas a conexão pode usar).
-- Só `margens` e `catalogo` existem; nenhuma dá escrita. `publiai_loja` não exige permissão.
-- O default '{margens,catalogo}' preenche as chaves já emitidas e mantém a edge antiga (que não conhece
-- a coluna) funcionando no intervalo entre a migration e o deploy.
-- `db push` não roda em transação: cada bloco é re-executável.
alter table public.agente_conexoes add column if not exists permissoes text[] not null default '{margens,catalogo}';

do $$ begin
  alter table public.agente_conexoes add constraint agente_conexoes_permissoes_check
    check (permissoes <@ '{margens,catalogo}'::text[] and cardinality(permissoes) >= 1);
exception when duplicate_object then null; end $$;

comment on column public.agente_conexoes.permissoes is 'Ferramentas que a chave pode usar (ADR-0210, Emenda 6).';
