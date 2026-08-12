-- ============================================================================
-- ADR-0112 — Alíquota interna por UF da empresa (venda dentro do estado)
-- ============================================================================

-- UF de origem da empresa + alíquota aplicada quando o pedido é entregue nessa UF.
-- Ambas NULLABLE e SEM DEFAULT: null = parâmetro não configurado = regra por origem
-- (ADR-0055) inalterada. Nenhuma org existente muda de comportamento ao aplicar isto.
alter table public.configuracoes
  add column if not exists uf_empresa text,
  add column if not exists aliquota_interna_pct numeric;

-- Trava de meia-configuração: UF sem percentual (ou vice-versa) aplicaria um imposto
-- parcial em silêncio num caminho financeiro. Os dois juntos, ou nenhum.
alter table public.configuracoes
  drop constraint if exists configuracoes_aliquota_interna_coerente;
alter table public.configuracoes
  add constraint configuracoes_aliquota_interna_coerente
  check ((uf_empresa is null) = (aliquota_interna_pct is null));

-- Formato canônico da UF: 2 letras maiúsculas, sem o prefixo "BR-" — o mesmo que
-- extrairGeo grava em ml_vendas.uf, senão a comparação nunca casa.
alter table public.configuracoes
  drop constraint if exists configuracoes_uf_empresa_formato;
alter table public.configuracoes
  add constraint configuracoes_uf_empresa_formato
  check (uf_empresa is null or uf_empresa ~ '^[A-Z]{2}$');

-- Percentual entre 0 e 100, como as demais alíquotas.
alter table public.configuracoes
  drop constraint if exists configuracoes_aliquota_interna_faixa;
alter table public.configuracoes
  add constraint configuracoes_aliquota_interna_faixa
  check (aliquota_interna_pct is null or (aliquota_interna_pct >= 0 and aliquota_interna_pct <= 100));
