# Expandir item em Publicados — Análise + modo Clássico/Premium

**Data:** 2026-06-24
**Status:** aprovado

## Objetivo

No menu **Publicados**, cada linha pode expandir e mostrar a `Análise para publicação`
daquele item (o mesmo painel da tela de Revisão), recalculada pelo **preço atual no ML**.
Além disso, mostrar se o anúncio foi publicado em modo **Clássico** (`gold_special`) ou
**Premium** (`gold_pro`): selo na linha + destaque do modo real no card "Você recebe por venda".

## Decisões

- **Preço base da análise:** preço atual no ML (`precoAtual`), com fallback para o preço de
  publicação salvo (`precoPublicacao`) quando o ML não retorna o atual.
- **Como mostrar Clássico/Premium:** selo na linha da tabela (visível sem expandir) **e**
  destaque ("✓ publicado") no card de comparação ao expandir.
- **Origem do `listing_type`:** ao vivo do ML, via o sync `status-publicados` (sem migração de
  banco). O `listing_type_id` não é persistido na publicação; é lido junto com status/preço.

## Arquitetura

### Backend — `listing_type` ao vivo

O sync `status-publicados` já lê em lote `GET /items?ids=...&attributes=id,status,sub_status,available_quantity,price`
via o conector ML (`lerStatus`). Adicionamos `listing_type_id` aos atributos e propagamos:

1. `supabase/functions/_shared/ml/status.ts`
   - `ItemMLStatus` ganha `listing_type_id?: string`.
   - `parseStatusML` mapeia `gold_special → 'classico'`, `gold_pro → 'premium'`, ausente/outro → `null`.
2. `supabase/functions/_shared/canais/contrato.ts`
   - `StatusCanal` ganha `listingType: 'classico' | 'premium' | null`.
3. `supabase/functions/_shared/canais/mercado-livre.ts`
   - `lerStatus`: incluir `listing_type_id` na querystring `attributes`.
4. `supabase/functions/status-publicados/index.ts`
   - Já faz `{ ml_item_id: id, ...statusPorId[id] }` → `listingType` flui automaticamente. Sem mudança.

Deploy: redeployar via CLI todas as funções afetadas pela mudança em `_shared`
(no mínimo `status-publicados`; demais que importam `lerStatus`/`StatusCanal`/`parseStatusML`).

### Front

5. `src/lib/publicados.ts`
   - `PublicadoItem` ganha `listingType?: 'classico' | 'premium' | null`.
   - A função de merge do status (que hoje preenche `status`, `estoque`, `precoAtual`) também
     preenche `listingType` a partir do payload de `status-publicados`.
6. `src/components/painel-analise.tsx`
   - `PainelAnalise` ganha duas props **opcionais**, sem alterar o uso atual na Revisão:
     - `precoOverride?: number` — quando definido, substitui o `precoPublicacao` calculado
       internamente (min das variações) na hora de alimentar o `SemaforoPreco` e o `CardVoceRecebe`.
     - `listingTypeReal?: 'classico' | 'premium' | null` — repassado ao `CardVoceRecebe`.
7. `src/components/card-voce-recebe.tsx`
   - `CardVoceRecebe` ganha prop opcional `real?: 'classico' | 'premium' | null`.
   - `Coluna` ganha prop `real?: boolean` e exibe um marcador "✓ publicado" quando é o modo real.
8. `src/pages/Publicados.tsx`
   - `LinhaTabela`: selo Clássico/Premium (badge) na linha; "—" quando `listingType` é `null`.
   - Linha vira expansível (chevron). Ao expandir, carrega a `Familia` por id (lazy) reusando o
     mapper/carregador existente e renderiza
     `<PainelAnalise familia={fam} precoOverride={item.precoAtual ?? item.precoPublicacao} listingTypeReal={item.listingType ?? null} />`.

## Fluxo de dados

`status-publicados` (ML ao vivo) → `StatusCanal.listingType` → merge em `PublicadoItem.listingType`
→ selo na linha + `listingTypeReal` no painel. O `CardVoceRecebe` recalcula a tarifa Clássico/Premium
via `useTarifaML(precoOverride, categoriaMlId)`.

## Casos de borda

- `listing_type` indisponível (ML não retorna, sem credencial ML) → selo "—", card sem destaque.
- Item sem `categoria_ml_id` → `CardVoceRecebe` mostra "defina a categoria" (comportamento atual).
- Item antigo sem `analise_mercado` → seção "Potencial de venda" não renderiza (já é condicional).
  Concorrência/potencial são o **snapshot salvo na publicação** (dado histórico); apenas
  preço/tarifa/markup recalculam pelo preço atual. Não re-rodamos análise de mercado.
- ML retorna `precoAtual = null` → análise usa `precoPublicacao` (fallback).

## Testes

- `parseStatusML`: extrai e mapeia `listing_type_id` (gold_special→classico, gold_pro→premium,
  ausente→null) — unit em `supabase/functions/_shared/ml/__tests__`.
- Merge de `PublicadoItem`: status com `listingType` popula o campo — unit em `tests/lib`.
- Front: `LinhaTabela` renderiza o selo correto; expandir renderiza o painel — page test.

## Fora de escopo

- Persistir `listing_type_id` em banco.
- Re-rodar análise de mercado/concorrência para itens já publicados.
- Permitir trocar Clássico↔Premium a partir desta tela.
