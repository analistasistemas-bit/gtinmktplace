---
tags: [modulo, fiscal]
atualizado: 2026-08-26
---

# Fiscal

Card "Empresa" em `/configuracoes` + etapa fiscal no cadastro (`/estoque`) + badge em Publicados.
Módulo pago `fiscal`, ligado por org (ADR-0135). Branch `worktree-fiscal-cadastro-nfe`, 15 tasks
concluídas, **aguardando merge (CI verde) e deploy** — ver [[Índice de ADRs]] (ADR-0135) e
`docs/how-to/deploy-e-migrations.md` (seção "Deploy pós-merge"). Supersede parcialmente o
ADR-0114 (design anterior de transmissão via provider SaaS, pausado por dependência externa).
Ver [[Estoque]], [[Publicação Mercado Livre]], [[Configurações]], [[Banco de Dados]].

## O que o PubliAI faz — e o que não faz

O PubliAI **não transmite NF-e**. Ele cadastra os dados fiscais de empresa e produto, empurra o
dado de produto para o ML via `fiscal_information` na publicação, e mostra a prontidão real
(`can_invoice`). Quem **emite** é o **Faturador do Mercado Livre** — grátis, automático no Full,
um clique nas demais logísticas. Certificado A1, opt-in do faturador e série ficam no painel do
ML, sem API — o PubliAI não pergunta nem registra essa etapa manual, só verifica o resultado.

V1 cobre só **Simples Nacional**. Regime Normal (`tax_rules` completo do ML) é V2.

## `tipo_pessoa` e o gate de PF

`organizations.tipo_pessoa` (`pf`\|`pj`, default `pf` — o default seguro). **PF nunca liga o
módulo `fiscal`, nem via SQL direto**: constraint no banco (`organizations_fiscal_exige_pj`), não
só na UI. Marcado manualmente pelo super-admin em `/organizacoes` — o PubliAI não detecta a
conversão de conta CPF→CNPJ no próprio Mercado Livre.

| tipo_pessoa | módulo fiscal | comportamento |
|---|---|---|
| pf | off | estado hoje — publica normal, nenhum campo fiscal |
| pf | on | impossível por constraint |
| pj | off | cadastro de empresa disponível, nada obrigatório |
| pj | on | cadastro de empresa e campos fiscais de produto obrigatórios |

## `empresa_fiscal` — cadastro da organização

Card "Empresa" em `/configuracoes`. Identidade (CNPJ, razão social, IE, regime tributário),
endereço fiscal completo, operação (natureza, CFOP, CST PIS/COFINS), `origin_type` (papel da
empresa no ML) e `emissao_a_partir_de` (corte temporal — vendas anteriores nunca viram pendência
fiscal). Tudo nullable no schema; a obrigatoriedade é só do **gate de ativação do módulo**
(checklist de 5 itens, validado server-side na edge `usuarios`, só super-admin):

1. `tipo_pessoa = 'pj'`
2. `empresa_fiscal` completa
3. `regime_tributario = 'simples'` (Regime Normal recusa com "v2")
4. `empresa_fiscal.uf` = `configuracoes.uf_empresa` (ADR-0112) — divergência falha LOUD nomeando
   as duas
5. `emissao_a_partir_de` preenchida

## Cadastro fiscal do produto — por família, empurrado por SKU

NCM, CSOSN/CST, CEST e origem fiscal **não mudam com a cor** — vivem em `familias`, não em
`variacoes`. Campos: `ncm` (8 dígitos, obrigatório para emitir), `cest` (opcional, só com ST),
`origem_nfe` (0–8, **nunca deriva** de `familias.origem` — o binário nacional/importado do
ADR-0055/0107 que segue calculando 8%/16% de imposto; os dois são digitados independentes, com
trava de coerência LOUD), `fci` (condicional a origem 3/5/8), `tributacao_icms` (CSOSN sob Simples
ou CST sob Normal — `tributacao_icms_regime` registra qual regime gerou o valor, detectando troca
de regime sem adivinhar).

Três formas de entrada:
- **Planilha** (`ingest-lote`): colunas `NCM` (obrigatória na org fiscal, aborta o lote se
  ausente/inválida — mesmo contrato do `ORIGEM`, ADR-0107), `CEST`/`ORIGEM_NFE`/`CSOSN`
  (opcionais, herdam da família anterior quando a célula vem vazia).
- **Cadastro manual** (`cadastrar-produto`): dialog em **3 etapas** (dados / fiscal / variações)
  quando o módulo está ativo — 2 etapas nas demais orgs. NCM **sugerido por IA** (edge
  `sugerir-ncm`, OpenRouter, nunca grava sozinha) a partir de nome/descrição/categoria ML,
  gravado só com confirmação ativa do operador.
- **Edição de fiscal pendente** (edge `atualizar-fiscal-familia`, modo edição do dialog): filtro
  "Fiscal pendente" em `/estoque` + "Salvar e próximo" percorre a fila sem voltar à lista —
  backfill do catálogo antigo.

## Push para o ML e o semáforo `can_invoice`

Porta `DadosFiscaisCanal` (`_shared/canais/fiscal-ml.ts`, padrão ADR-0024), adaptador único ML.
Worker `sincronizar-fiscal-ml` (QStash, idempotente — upsert POST→409→PUT por SKU) roda:
1. Na publicação (`publish-familia-ml` enfileira após criar o item).
2. Na edição fiscal de família já publicada (`atualizar-fiscal-familia` reenfileira).

`can_invoice` (`GET /can_invoice/items/{id}`) é o estado **do ML**, não uma dedução local —
escrito na hora pelo push e reconciliado a cada 6h pendurado no `monitorar-moderados` (nenhum
worker/schedule novo). Badge em Publicados: verde (pronto), vermelho (pendência com causa, clique
abre o dialog de edição fiscal), sem badge para org sem o módulo.

## Gates

- **Publicação/UPDATE**: família sem `ncm`/`origem_nfe`/`tributacao_icms` (ou regime divergente,
  ou `fci` ausente com origem 3/5/8) falha LOUD nomeando o campo, antes de qualquer escrita no ML.
  Reposição de estoque e ajuste de preço não passam por esse gate.
- **`ingest-lote`**: ver seção de planilha acima.
- **Ativação do módulo**: ver checklist de 5 itens acima.

## Limitação conhecida da v1

Anúncio externo/migrado **sem família** (`user_products` adotado) deveria aparecer em Publicados
como "sem cadastro fiscal — vincular a produto" (nunca sumir em silêncio, D-10). O `BadgeFiscal`
já sabe renderizar esse aviso, mas `fetchPublicados` (`src/lib/queries.ts`) descarta esses itens
**antes** de chegarem à UI — comportamento pré-existente da tela Publicados, não introduzido por
este ADR. Item futuro nomeado, não pendência silenciosa.

## Fora da v1 (V2 nomeadas no ADR-0135)

Consumo da nota emitida (chave/XML/DANFE na tela de vendas) · entrada por XML do fornecedor ·
Regime Normal (`tax_rules` completo) · IE por UF (`state_registry`) · adaptador de emissor externo
(a porta já existe; o segundo adaptador só quando houver cliente que recuse o Faturador do ML).
