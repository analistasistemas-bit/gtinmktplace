# Spec — Preço de atacado (PxQ) na publicação ao Mercado Livre

**Data:** 2026-06-24
**Branch:** `worktree-atacado-pxq`
**ADR:** [0041 — Preço de atacado via PxQ B2B do ML](../../decisions/0041-preco-atacado-pxq-b2b.md)
**Status:** Aprovado o design (Diego) — aguardando plano de implementação

## Objetivo

Permitir que, ao publicar, o operador defina **preço de atacado** para os produtos:
"a partir de X unidades, Y% de desconto", com **até 5 faixas** (limite do ML).
A configuração pode ser feita **para o lote inteiro** ou **por família independente**.

## Contexto / descobertas

- A feature equivale ao recurso nativo **PxQ (Preços por Quantidade)** do ML, endpoint
  `PUT /items/{ITEM_ID}/prices/standard/quantity`. **Não** usa `/seller-promotions` — logo
  **não** esbarra no bloqueio de permissão que estacionou o selo de desconto (ADR-0017).
- **Viabilidade confirmada:** a conta AVILBV (`user_id` ML `1003820507`) é **B2B**
  (`tags: ["business"]`, CNPJ `04917296000594`, `cust_type_id: "BU"`). O endpoint já
  está provado vivo: 2 anúncios (`MLB4806443015`, `MLB4806374301`) tiveram PxQ configurado
  **manualmente** no painel do ML em 23/06 (faixa de 5 un, `context_restrictions:
  [channel_marketplace, user_type_business]`).
- **Scaffolding parcial pré-existente** (criado 23/06, sem migration commitada, sem lógica):
  colunas `familias.atacado` (jsonb), `familias.atacado_status` (text), `familias.atacado_erro`
  (text) e `configuracoes.atacado_default` (jsonb). 0/65 famílias com dados. Tipos
  regenerados em `src/lib/database.types.ts`.
- **Preço uniforme entre cores:** 32/32 famílias multi-cor têm o mesmo `preco_publicacao` em
  todas as cores → o desconto aplica no **nível do anúncio** com um único preço-base.

## Decisões de produto (confirmadas com Diego)

1. **Escopo:** aplicar ao **publicar** (anúncios novos) **e sincronizar** no `update-familia-ml`
   (preço pode mudar → recalcula).
2. **Faixas:** definidas **a cada publicação** (sem padrão salvo). `configuracoes.atacado_default`
   fica **reservada/não usada**.

## Modelo de dados

Reusa as colunas existentes; **formaliza** via migration idempotente.

- `familias.atacado` (jsonb) — array de faixas, shape concreto:
  ```json
  [
    { "min_unidades": 5,  "desconto_pct": 5 },
    { "min_unidades": 10, "desconto_pct": 8 }
  ]
  ```
  - `null` ou `[]` = sem atacado.
  - Máx **5** faixas. `min_unidades` inteiro ≥ 2, estritamente crescente.
  - `desconto_pct` 1–99, crescente (mais unidades → mais desconto).
- `familias.atacado_status` (text) — `null` | `'pendente'` | `'aplicado'` | `'erro'`.
  Rastreio da aplicação PxQ no ML, **independente** do `status` de publicação.
- `familias.atacado_erro` (text) — mensagem do último erro de PxQ.
- `configuracoes.atacado_default` (jsonb) — **não usada** nesta entrega (documentada como reservada).

**Migration** `supabase/migrations/<ts>_familias_atacado.sql`: `add column if not exists` para
as 3 colunas de `familias` + comentários (`comment on column`). Reproduz o schema que hoje só
existe no banco remoto.

## Conversão % → R$ (ML exige valor absoluto)

O ML guarda `amount` absoluto por faixa, não percentual. A partir do preço-base do anúncio
(`preco_publicacao`, uniforme entre as cores):

```
amount(faixa) = arredondar2( precoBase × (1 − desconto_pct/100) )
```

O payload do PxQ é o **conjunto completo** de preços:

```json
{
  "prices": [
    { "type": "standard", "amount": <precoBase>, "currency_id": "BRL",
      "conditions": { "context_restrictions": [] } },
    { "type": "standard", "amount": <amount5>, "currency_id": "BRL",
      "conditions": { "context_restrictions": ["channel_marketplace","user_type_business"],
                      "min_purchase_unit": 5 } },
    { "type": "standard", "amount": <amount10>, "currency_id": "BRL",
      "conditions": { "context_restrictions": ["channel_marketplace","user_type_business"],
                      "min_purchase_unit": 10 } }
  ]
}
```

- Faixa base (preço cheio, sem restrição) **sempre** presente.
- Faixas de atacado com `min_purchase_unit` + `context_restrictions` B2B.
- Faixas vazias = enviar só a base (limpa o PxQ existente).

## Camada de aplicação no ML

**Novo módulo** `supabase/functions/_shared/ml/atacado.ts`:

- `montarFaixasPxQ(precoBase, faixas): PricePxQ[]` — puro/testável. Monta base + faixas,
  aplica o cálculo %→R$, ordena por `min_unidades`. `faixas` vazio → só a base.
- `aplicarPxQ(token, itemId, precoBase, faixas): Promise<void>` — `PUT
  /items/{itemId}/prices/standard/quantity` com o conjunto montado. Idempotente (PUT
  sobrescreve). Lança em erro HTTP (com a mensagem do ML).

**Conector de canal** (`_shared/canais/`): expor `aplicarAtacado(ctx, itemId, precoBase, faixas)`
no contrato e marcar capability `atacado: true` no conector ML.

## Fluxo nos workers

### `publish-familia-ml`
Após criar o item e persistir `ml_item_id` (depois do bloco de descrição/catálogo):
- Se `familia.atacado` tem faixas → `conn.aplicarAtacado(...)`.
  - Sucesso → `atacado_status='aplicado'`, `atacado_erro=null`.
  - Falha → `atacado_status='erro'`, `atacado_erro=<msg>`. **Best-effort**: NÃO derruba o
    anúncio já criado (mesmo padrão de descrição/catálogo).
- **Idempotência:** o ramo "item já publicado" (`familia.ml_item_id` presente) também garante o
  PxQ quando `atacado_status != 'aplicado'` e há faixas.

### `update-familia-ml` (sincronizar)
Quando a família é atualizada e tem faixas → reaplica (recalcula `amount` a partir do preço
atual). Mesmo `montarFaixasPxQ` / `aplicarAtacado`. Best-effort, atualiza `atacado_status`.

## UI (`src/pages/Revisao.tsx` + `src/components/familia-row.tsx`)

- **Por família:** novo controle "Preço de atacado" próximo ao `DescontoControle`:
  - toggle ativar/desativar;
  - editor de até 5 faixas (`min unidades` + `% off`), com botão "adicionar faixa" (até 5) e
    preview por faixa: `≥ 5 un: R$ 11,90 (−5%)`;
  - mutations espelhando `useUpdateExibirDesconto` / `useUpdateDescontoPctFamilia`
    (`src/hooks/useFamiliaMutations.ts`) → gravam em `familias.atacado`.
- **Lote inteiro:** ação no header da Revisão "Aplicar atacado a todas as famílias" — abre o
  mesmo editor e grava as faixas em **todas** as famílias do lote (mutation em massa).
- **Status inline:** na linha publicada, pill `atacado ✓` / `atacado ⚠` (erro no `title`).
  Sem toast (preferência de feedback inline).
- Validação no front: `min_unidades` ≥ 2 e crescente; `desconto_pct` 1–99 e crescente; máx 5
  faixas; bloqueia salvar inconsistente.

## Erros e bordas

- ML pode ter **piso de preço** por categoria/listing. Se recusar uma faixa → `atacado_status
  ='erro'` com a mensagem do ML; **não bloqueia** a publicação.
- **Preços variados entre cores** (0% hoje): usar o preço **representativo** (mínimo das cores
  incluídas) como base e documentar. Faixa por-variação fica **fora do escopo** (YAGNI) — abrir
  follow-up se algum dia surgir família com preços diferentes por cor.
- Token: reusa `getValidAccessToken` (já no worker). Scope `write` já presente.

## Testes

- **Unit (vitest)** de `montarFaixasPxQ`:
  - cálculo %→R$ e arredondamento;
  - base sempre presente; faixas ordenadas por `min_unidades`;
  - `faixas` vazio → só a base (limpa PxQ);
  - múltiplas faixas (até 5).
- **Validação de faixas** (front + util compartilhado): rejeita `min_unidades` < 2, não
  crescente, `desconto_pct` fora de 1–99, > 5 faixas.
- (Opcional) teste de integração contra item real B2B em ambiente controlado.

## Fora de escopo

- Padrão salvo global (`configuracoes.atacado_default`).
- Faixa de atacado por-variação (preço diferente por cor).
- Campanhas VOLUME via `/seller-promotions` (bloqueadas; ver ADR-0017/0041).
- Atacado em outros canais (Shopee etc.).

## Arquivos afetados (mapa)

| Camada | Arquivo | Ação |
|---|---|---|
| Migration | `supabase/migrations/<ts>_familias_atacado.sql` | criar (formaliza colunas) |
| ML client | `supabase/functions/_shared/ml/atacado.ts` | criar (`montarFaixasPxQ`, `aplicarPxQ`) |
| Conector | `supabase/functions/_shared/canais/contrato.ts` + conector ML | `aplicarAtacado` + capability |
| Worker | `supabase/functions/publish-familia-ml/index.ts` | aplicar PxQ pós-criação + ramo já-publicado |
| Worker | `supabase/functions/update-familia-ml/index.ts` | reaplicar PxQ no update |
| Front mutations | `src/hooks/useFamiliaMutations.ts` | mutation atacado (por família + em massa) |
| Front UI | `src/components/familia-row.tsx` | controle de atacado por família |
| Front UI | `src/pages/Revisao.tsx` | ação "aplicar ao lote" + status |
| Domínio | `src/lib/tipos-dominio.ts` | tipo `FaixaAtacado` no `Familia` |
| Util | `src/lib/atacado.ts` | cálculo/validação espelho (front) |
| Tipos | `src/lib/database.types.ts` | já tem as colunas (regen se preciso) |
