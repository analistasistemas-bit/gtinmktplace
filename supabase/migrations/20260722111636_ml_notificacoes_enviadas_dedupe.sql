-- Dedupe de notificações de faturamento (backlog do code-review-fable5, lote 4).
-- sync-venda/sync-pergunta/sync-devolucao decidem "é novo?" via SELECT-então-UPSERT em
-- _shared/faturamento/{io,perguntas-io,devolucoes-io}.ts — não atômico sob execução concorrente
-- (retry QStash, fail-open de classificarDedupWebhook). Esta tabela resolve a corrida na camada
-- de notificação (não no dado, que já upserta corretamente): só quem ganha o INSERT da PK
-- composta abaixo pode notificar. Ver docs/superpowers/specs/2026-07-22-dedupe-notificacoes-faturamento-design.md.
create table public.ml_notificacoes_enviadas (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  entidade   text not null,          -- 'venda_paga' | 'pergunta_nova' | 'devolucao_nova'
  chave      text not null,          -- order_id / question_id / claim_id como string
  enviado_em timestamptz not null default now(),
  primary key (org_id, entidade, chave)
);

alter table public.ml_notificacoes_enviadas enable row level security;

-- Só-leitura no app (mesmo padrão do Grupo B de 20260705165828_e7_rls_org.sql); escrita é
-- só do worker via service role (bypassa RLS) — sem policy de insert/update/delete.
create policy "ml_notificacoes_enviadas: select org" on public.ml_notificacoes_enviadas
  for select to authenticated using (org_id = (select public.current_org_id()));

grant select on public.ml_notificacoes_enviadas to authenticated;
grant all on public.ml_notificacoes_enviadas to anon, authenticated;
