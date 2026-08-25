# Spec — Cadastro fiscal e integração com o Faturador do ML (v1)

**Data:** 2026-08-25 · **ADR:** [0135](../../decisions/0135-cadastro-fiscal-e-faturador-do-ml.md)
(supersede parcialmente o [0114](../../decisions/0114-emissao-de-nf-e-modelo-55.md))
**Gatilho:** cliente da org DSA abrindo CNPJ para migrar a operação de PF para PJ e emitir NF-e de
venda pelo Faturador do Mercado Livre.

Decisões e racional vivem no ADR-0135. Esta spec materializa: schema, contratos, telas, gates e
critério de saída. Design fechado em sessão de grilling (11 perguntas respondidas pelo Diego) +
revisão de gaps.

---

## 1. Escopo em uma frase

O PubliAI passa a ter cadastro fiscal completo de **empresa** (org) e **produto** (família),
empurra os dados de produto para o ML via API `fiscal_information`, e mostra a prontidão real de
faturamento (`can_invoice`) — a emissão em si é do Faturador do ML. Simples Nacional apenas.

**Fora da v1** (V2 nomeadas no ADR): consumo da nota emitida, entrada por XML do fornecedor,
Regime Normal (`tax_rules`), IE por UF (`state_registry`), adaptador de emissor externo.

## 2. Schema (migrations via `supabase migration new` + `db push`, ADR-0043)

### 2.1 `organizations`

```sql
alter table organizations add column tipo_pessoa text not null default 'pf'
  check (tipo_pessoa in ('pf','pj'));
-- PF jamais liga o módulo fiscal — trava no banco, não na UI:
alter table organizations add constraint fiscal_exige_pj
  check (not ('fiscal' = any(modulos_habilitados)) or tipo_pessoa = 'pj');
```

`fiscal` entra em `MODULOS_VALIDOS` (`supabase/functions/usuarios/index.ts`) e em
`src/lib/modulos.ts`.

### 2.2 `empresa_fiscal` (nova, PK `org_id`, RLS por org — padrão das tabelas de domínio)

| Grupo | Colunas | Notas |
|---|---|---|
| Identidade | `cnpj`, `razao_social`, `nome_fantasia`, `inscricao_estadual`, `regime_tributario` | regime: check `in ('simples','normal')`; CNPJ com validação de dígito no app |
| Endereço | `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `municipio`, `municipio_ibge`, `uf` | `uf` check `~ '^[A-Z]{2}$'`; `municipio_ibge` 7 dígitos |
| Operação | `natureza_operacao`, `cfop_dentro_uf`, `cfop_fora_uf_nao_contribuinte`, `cfop_fora_uf_contribuinte` (nullable), `cst_pis`, `cst_cofins` | semântica do par: ADR-0114 D-10 (`5102`/`6108`; slot contribuinte p/ PJ com IE) |
| ML | `origin_type` | check `in ('manufacturer','reseller','imported')` — papel da empresa |
| Corte | `emissao_a_partir_de date` | vendas anteriores nunca viram pendência fiscal |
| Auditoria | `criado_em`, `atualizado_em` | padrão do projeto |

Todos os campos nullable no schema — a **obrigatoriedade é do gate de ativação** (§5.3), não do
INSERT. `configuracoes.uf_empresa` intocado (ADR-0112); coerência com `empresa_fiscal.uf` validada
na ativação (LOUD).

### 2.3 `familias`

```sql
alter table familias
  add column ncm text,                     -- 8 dígitos; obrigatório p/ emitir (gate, não NOT NULL)
  add column cest text,                    -- 7 dígitos, opcional (só com ST)
  add column origem_nfe smallint,          -- 0–8; check (origem_nfe between 0 and 8)
  add column fci text,                     -- UUID FCI; condicional a origem_nfe in (3,5,8)
  add column ex_tipi text,                 -- opcional
  add column tributacao_icms text,         -- CSOSN (Simples) ou CST (Normal)
  add column tributacao_icms_regime text   -- check in ('simples','normal'); registra o regime que gerou o valor
```

Coerência origem binária × 0–8 (validação de app, LOUD nas duas direções, nunca derivação —
ADR-0135 D-5):

| `familias.origem` | `origem_nfe` permitidos |
|---|---|
| `nacional` | 0, 3, 4, 5, 8 |
| `importado` | 1, 2, 6, 7 |

`unidade` (famílias) passa a vocabulário controlado (lista congelada no item "A verificar" nº 3 do
ADR — `UN`, `KG`, `PAR`, `CX`, `PC`… conforme o ML aceitar). Valores legados fora da lista viram
pendência fiscal, não erro retroativo.

### 2.4 O que NÃO muda

`familias.origem` e o cálculo de imposto 8%/16% (ADR-0055/0107) · `configuracoes.*` ·
`variacoes` (o push lê `gtin` e pesos existentes) · `ml_vendas` (nada de nota na v1).

## 3. Porta `DadosFiscaisCanal` e push para o ML

Nova porta em `supabase/functions/_shared/canais/` (padrão ADR-0024/0061), adaptador único ML:

```
empurrarFiscalSku(sku)        → POST/PATCH /items/fiscal_information       (upsert por SKU)
vincularSkuAnuncio(vinculo)   → POST /items/fiscal_information/items       ({sku, item_id, variation_id})
prontidaoItem(item_id)        → GET  /can_invoice/items/{item_id}          (→ boolean + causas)
```

Montagem do payload por SKU (na hora, sem tabela nova): fiscal da família (`ncm`, `cest`,
`origem_nfe` → `origin_detail`, `tributacao_icms` → `csosn`, `fci`, `ex_tipi`) + `origin_type` da
`empresa_fiscal` + `ean` = `variacoes.gtin`, `measurement_unit` = `familias.unidade`,
`net_weight`/`gross_weight` = `variacoes.peso_gramas` + por fim `sku` = `variacoes.codigo` (que já
é o `seller_custom_field` publicado — vínculo confirmado no código).

**Quando roda o push** (worker QStash idempotente, `verify_jwt=false`, padrão do projeto):

1. Na publicação (`publish-familia-ml` enfileira após criar o item) — push + vínculo.
2. Na edição fiscal de família já publicada — re-push (PATCH) + re-vínculo se preciso.
3. Replay do QStash não duplica: upsert por SKU é naturalmente idempotente; o worker ainda registra
   `familias.fiscal_sincronizado_em` para diagnóstico.

Falha de push **não desfaz a publicação** — vira pendência visível (badge vermelho via
`can_invoice`) e retry padrão do QStash.

## 4. Reconciliação e semáforo

- A reconciliação horária existente ganha um passo: para org com módulo `fiscal`, ler
  `can_invoice` dos itens publicados e gravar `familias.can_invoice` (boolean + `atualizado_em`).
  Nenhum worker novo.
- **Publicados**: badge por anúncio — verde (pronto), vermelho (não pronto, com causa), cinza
  (org sem módulo: sem badge).
- **Anúncios externos/migrados sem família**: linha marcada "sem cadastro fiscal — vincular a
  produto". Nunca somem em silêncio.
- Vendas com `date_created < emissao_a_partir_de` são invisíveis para qualquer lógica fiscal.

## 5. Gates (org PJ + módulo fiscal ativo)

### 5.1 Publicação e UPDATE
`publish-familia-ml` / `update-familia-ml`: família sem `ncm`, `origem_nfe` ou `tributacao_icms`
(ou com `tributacao_icms_regime` ≠ regime da org, ou `fci` ausente com origem 3/5/8) → **falha
LOUD nomeando o campo**, antes de qualquer escrita no ML. Reposição de estoque e ajuste de preço
não passam por esse gate.

### 5.2 Planilha (`ingest-lote`)
Coluna `NCM` adicionada ao contrato (`_shared/types.ts`). Org com módulo fiscal: `NCM` vazio ou
inválido **aborta o lote** (mesmo contrato do `ORIGEM`, ADR-0107). Org sem módulo: coluna ignorada;
planilhas atuais seguem válidas. Colunas opcionais aceitas quando presentes: `CEST`, `ORIGEM_NFE`,
`CSOSN`.

### 5.3 Ativação do módulo (edge `usuarios`, só super-admin)
Checklist validado server-side, cada item com mensagem própria:
1. `tipo_pessoa = 'pj'` (a constraint do banco é a rede; esta é a mensagem)
2. `empresa_fiscal` completa (identidade + endereço + operação + `origin_type`)
3. `regime_tributario = 'simples'` (Normal: recusa com "v2")
4. `empresa_fiscal.uf` = `configuracoes.uf_empresa` (divergência: LOUD nomeando as duas)
5. `emissao_a_partir_de` preenchida

## 6. UI

### 6.1 `/configuracoes` — card "Empresa"
Sempre visível. `tipo_pessoa` é exibido, somente leitura — quem marca é o super-admin, pelo mesmo
fluxo que liga módulos (edge `usuarios`).
Org PJ vê o formulário de `empresa_fiscal` (nada obrigatório até ligar o módulo — validação
inline, obrigatoriedade só no gate). Org PF vê aviso "emissão fiscal exige conta PJ". Card mostra o
checklist de ativação (§5.3) com o estado de cada item e a instrução das etapas manuais do painel
do ML (opt-in do faturador, certificado A1, série) — sem checkbox de auto-declaração.

### 6.2 `/estoque` — dialog de produto em 3 etapas + modo edição + fila
- `dialog-cadastro-produto.tsx` vira 3 etapas: **1 dados · 2 fiscal · 3 variações**. Etapa fiscal
  só aparece (e só valida) em org com módulo fiscal; nas demais o dialog segue com 2 etapas.
- **Modo edição** (novo): abrir produto existente com valores carregados; edge nova ou extensão da
  `cadastrar-produto` com update idempotente (decisão fica para o plano).
- Filtro **"fiscal pendente"** na lista (família sem `ncm`/`origem_nfe`/`tributacao_icms` ou
  `can_invoice = false`).
- **"Salvar e próximo"** no modo edição dentro do filtro — avança para o próximo pendente sem
  voltar à lista.
- **NCM sugerido por IA** (OpenRouter, ADR-0026): sugerido a partir de nome + descrição +
  categoria ML, exibido como sugestão claramente marcada, gravado **só com confirmação ativa**.
  Nunca em lote, nunca default. CSOSN não é sugerido por IA (vem do contador; a UI oferece o último
  valor usado pela org como conveniência explícita, também confirmável).

### 6.3 Publicados
Badge `can_invoice` (§4). Ação do badge vermelho: abre o dialog de edição na etapa fiscal.

## 7. Erros e mensagens

- Toda falha de gate nomeia **o campo e a org/família** — nunca "dados inválidos".
- Push com 4xx do ML: pendência com a mensagem do ML traduzida; 5xx/timeout: retry QStash.
- Ativação recusada lista **todos** os itens faltantes de uma vez, não um por tentativa.

## 8. Testes (gate padrão do projeto: `pnpm test` + `tsc` + `deno check` + lint + build)

1. Constraint `fiscal_exige_pj` recusa PF+fiscal **no Postgres real** (não só mock — lição do
   ADR-0129).
2. Coerência origem × origem_nfe: tabela do §2.3, casos válidos e inválidos.
3. Gate de publicação: família incompleta falha nomeando o campo; completa publica e enfileira push.
4. `ingest-lote`: org com módulo aborta sem NCM; org sem módulo ignora a coluna (planilha atual
   passa intacta).
5. Push idempotente: replay do QStash não duplica nem regride estado.
6. Corte temporal: venda anterior a `emissao_a_partir_de` nunca aparece como pendência.
7. Ativação: os 5 itens do checklist individualmente reprovados e a mensagem de cada um.
8. UI: dialog 2 vs 3 etapas conforme módulo; "Salvar e próximo" percorre a fila; sugestão de NCM
   exige confirmação (não salva sem).

## 9. Critério de saída da v1

1. Org DSA (pós-CNPJ real) com módulo ligado: produto completo publica, `fiscal_information`
   aceito, `can_invoice = true` visível no Publicados.
2. Produto sem NCM não publica, com o campo nomeado; catálogo antigo aparece na fila "fiscal
   pendente" e é preenchível em sequência com "Salvar e próximo".
3. AVIL (PJ, módulo off) e qualquer org PF: **zero mudança de comportamento** — publica como hoje,
   planilha de hoje passa, nenhuma tela nova obrigatória.
4. PF não consegue ligar o módulo nem via SQL direto (constraint).
5. Venda anterior ao corte nunca gera pendência; a primeira venda posterior ao corte com
   `can_invoice = true` é faturável no painel do ML em 1 clique (verificação manual com o cliente).
6. Docs (`docs/reference/modelo-de-dados.md`, `edge-functions.md`, glossário) e `obsidian-vault/`
   atualizados no mesmo commit; Graphify re-ingerido + poda.

## 10. Riscos aceitos

- Onboarding tem perna manual invisível à API (opt-in, A1, série) — mitigado por instrução na UI +
  `can_invoice` como verificação real.
- Dependência do faturador do ML — amortecida pela porta e pelo cadastro portável (ADR-0135,
  Consequências).
- Sugestão de NCM errada aceita por desatenção — mitigada por marcação visual de sugestão +
  confirmação ativa por família (nunca lote); responsabilidade final é do operador com o contador.
