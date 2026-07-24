-- ADR-0088 — Reconciliador de convergência: orçamento de rodadas por raiz + claim atômico.
-- `atualizado_em` (moddatetime, já existe) não serve de contador de tentativas — o próprio
-- reconciliador escreve na linha a cada passada, apagando o sinal de "há quanto tempo está
-- travado". Coluna dedicada, incrementada 1x por passada do reconciliador sobre a raiz; zerada
-- sempre que a intenção transitória (mudando_composicao) é limpa com sucesso.
alter table public.anuncios_externos
  add column if not exists reconciliacao_tentativas int not null default 0;

comment on column public.anuncios_externos.reconciliacao_tentativas is
  'Rodadas do reconciliador de convergência gastas tentando resolver mudando_composicao=true ou estado_desejado não-nulo desta raiz. Zerada ao convergir; >= orçamento sem convergir -> erro terminal (ADR-0088).';

-- Referência durável à família do episódio (revisão adversarial, Codex — achado real): a raiz UP
-- (anuncios_externos, chave org_id+canal+codigo_pai+particao) NÃO tem FK direta pra uma família
-- específica — múltiplas linhas de `familias` compartilham o mesmo codigo_pai (1 por lote de
-- UPDATE). Resolver "a família atual" por `order by publicado_em desc` ao reconciliar é ERRADO:
-- pode escolher uma família de OUTRO lote, misturando descrição/categoria/fotos/atacado/variações
-- de origens diferentes — o worker normal (update-familia-ml/processar.ts) sempre recebe um
-- `job.familia_id` EXATO, nunca infere por recência. A raiz precisa gravar QUAL família iniciou a
-- mudança de composição, no MESMO momento em que liga mudando_composicao=true, pra o
-- reconciliador retomar com a família CERTA. Precisa vir ANTES da função abaixo, que a referencia.
alter table public.anuncios_externos
  add column if not exists mudando_composicao_familia_id uuid references public.familias(id) on delete set null;

comment on column public.anuncios_externos.mudando_composicao_familia_id is
  'Família que iniciou a mudança de composição em andamento (gravada junto com mudando_composicao=true). Referência durável pro reconciliador de convergência resolver a família EXATA a retomar — nunca inferir por recência (múltiplas famílias compartilham codigo_pai). null quando mudando_composicao=false (ADR-0088).';

-- CLAIM atômico (substitui o increment "cego" da 1ª versão — achado real em revisão adversarial,
-- Codex: um simples UPDATE...SET+1 sem WHERE de re-checagem não é anti-corrida nenhuma, só um
-- increment). Esta função RE-CHECA `mudando_composicao=true` e `atualizado_em` ainda velho
-- ATOMICAMENTE dentro do mesmo UPDATE que incrementa — se a linha já tiver sido tocada (worker
-- normal já em andamento, ou outra execução concorrente do reconciliador que já a reivindicou),
-- o WHERE não bate, zero linhas são afetadas, a função retorna NULL, e o chamador pula a raiz.
--
-- Escopo real da garantia (revisão adversarial, 2ª rodada — não superestimar): o claim protege
-- contra (a) 2 execuções do reconciliador disputando a mesma raiz e (b) um worker que JÁ tocou a
-- raiz antes do claim (atualizado_em recente reprova o WHERE). NÃO cria um lease/lock que dure
-- durante toda a retomada — um worker normal do UPDATE que comece um instante DEPOIS do claim
-- (mas antes do reconciliador terminar de resumir a saga) não é bloqueado por esta função. Fechar
-- esse caso exigiria o worker normal também participar do mesmo mecanismo de claim (mudando o hot
-- path de toda chamada de UPDATE) — desproporcional pra uma janela rara (a saga já tolera
-- reexecução sequencial idempotente; o risco aqui é 2 sagas rodando ao mesmo tempo, mesma classe
-- de "sem lock contra concorrência" já aceita no resto do ADR-0088, atualizar-familia-up.ts).
-- Mitigado pela janela anti-corrida de 15min antes de sequer tentar o claim (dá tempo real do
-- worker normal, que reage a cliques do operador, terminar antes do reconciliador competir).
--
-- Retorna, no mesmo round-trip, TUDO que o reconciliador precisa pra retomar com segurança: a
-- família EXATA que iniciou o episódio (mudando_composicao_familia_id — nunca inferir por
-- recência, achado real: múltiplas famílias compartilham codigo_pai), titulo/criado_em da raiz
-- (necessários pro family_name e pra janela de busca de órfão da saga) e o reconciliacao_tentativas
-- JÁ incrementado (evita o bug de usar o valor obsoleto lido antes do increment).
create or replace function public.reconciliar_convergencia_claim(
  p_root_id uuid,
  p_atualizado_antes timestamptz
)
returns table (
  org_id uuid,
  codigo_pai text,
  titulo text,
  criado_em timestamptz,
  skus_esperados jsonb,
  mudando_composicao_familia_id uuid,
  reconciliacao_tentativas int
)
language sql
security definer
set search_path = ''
as $$
  update public.anuncios_externos ae
  set reconciliacao_tentativas = ae.reconciliacao_tentativas + 1
  where ae.id = p_root_id
    and ae.mudando_composicao = true
    and ae.atualizado_em < p_atualizado_antes
  returning ae.org_id, ae.codigo_pai, ae.titulo, ae.criado_em, ae.skus_esperados,
    ae.mudando_composicao_familia_id, ae.reconciliacao_tentativas;
$$;

comment on function public.reconciliar_convergencia_claim(uuid, timestamptz) is
  'ADR-0088: claim atômico de uma raiz travada em mudando_composicao=true pro reconciliador de convergência. Re-checa mudando_composicao=true e atualizado_em < p_atualizado_antes DENTRO do mesmo UPDATE que incrementa reconciliacao_tentativas — zero linhas afetadas (retorno vazio) significa "outra execução/worker já tocou esta raiz, pule". Retorna também a referência durável à família do episódio (nunca inferida por recência) e titulo/criado_em pra retomar a saga com os mesmos dados que o worker normal usaria.';

revoke all on function public.reconciliar_convergencia_claim(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reconciliar_convergencia_claim(uuid, timestamptz) to service_role;
