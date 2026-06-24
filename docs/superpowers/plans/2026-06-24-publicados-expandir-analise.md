# Expandir item em Publicados — Plano de implementação

> **For agentic workers:** execução TDD, task a task, commits frequentes.

**Goal:** Cada linha de Publicados expande mostrando a `Análise para publicação` (preço atual no ML)
e indica se o anúncio é Clássico (`gold_special`) ou Premium (`gold_pro`).

**Architecture:** `listing_type_id` lido ao vivo do ML no sync `status-publicados` (sem migração),
propagado via `StatusCanal` até `PublicadoItem`. Reuso do `PainelAnalise` com props opcionais
(`precoOverride`, `listingTypeReal`). Linha expansível carrega a `Familia` por id sob demanda.

## Global Constraints

- Stack: React 18 + TS + Vite + shadcn/ui; testes Vitest (coletados em `tests/**` e
  `supabase/functions/**/__tests__/**`).
- Edge Functions idempotentes; deploy via CLI das funções afetadas pelo `_shared`.
- Não alterar comportamento da tela Revisão (props novas são opcionais).
- `listing_type` mapeado: `gold_special → 'classico'`, `gold_pro → 'premium'`, resto → `null`.

---

### Task 1: Backend — `listing_type` no parse de status ML

**Files:**
- Modify: `supabase/functions/_shared/ml/status.ts`
- Test: `supabase/functions/_shared/ml/__tests__/status.test.ts`

- [ ] Teste: `parseStatusML({status:'active', listing_type_id:'gold_special'})` → `listingType:'classico'`;
  `'gold_pro'` → `'premium'`; ausente/desconhecido → `null`; item null → `null`.
- [ ] `ItemMLStatus` ganha `listing_type_id?: string`.
- [ ] `StatusParsed` ganha `listingType: 'classico' | 'premium' | null`.
- [ ] `parseStatusML`: mapear `listing_type_id` (helper local `mapListingType`); `null` quando item null.
- [ ] Rodar testes do arquivo.

### Task 2: Backend — `StatusCanal.listingType` + `lerStatus` busca o atributo

**Files:**
- Modify: `supabase/functions/_shared/canais/contrato.ts` (`StatusCanal` + `listingType`)
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts` (`lerStatus`: querystring `attributes`)

- [ ] `StatusCanal` ganha `listingType: 'classico' | 'premium' | null`.
- [ ] `lerStatus`: incluir `listing_type_id` em `attributes=id,status,sub_status,available_quantity,price,listing_type_id`.
- [ ] `status-publicados/index.ts` já repassa `...statusPorId[id]` → sem mudança.
- [ ] `pnpm test` (garantir que nada quebrou; tipos compatíveis StatusParsed↔StatusCanal).

### Task 3: Front — `PublicadoItem.listingType` + merge do status

**Files:**
- Modify: `src/lib/publicados.ts` (`PublicadoItem.listingType?`)
- Modify: `src/lib/queries.ts` (`StatusPublicadoItem.listingType?`)
- Modify: `src/pages/Publicados.tsx` (merge ~316 inclui `listingType: s.listingType ?? null`)
- Test: `tests/lib/publicados.test.ts` (já existe) — não obrigatório novo; o merge é trivial.

- [ ] `PublicadoItem` ganha `listingType?: 'classico' | 'premium' | null`.
- [ ] `StatusPublicadoItem` ganha `listingType?: 'classico' | 'premium' | null`.
- [ ] No `merged` da página: `{ ...item, ..., listingType: s.listingType ?? null }`.

### Task 4: Front — loader de `Familia` por id (lazy)

**Files:**
- Modify: `src/lib/queries.ts` (`fetchFamiliaPublicada` + `QK.familia`)
- Create: `src/hooks/useFamilia.ts`

- [ ] `fetchFamiliaPublicada(familiaId)`: `.from('familias').select('*, variacoes(*)').eq('id', familiaId).single()`
  → `familiaFromRow(row)`. Lança em erro.
- [ ] `QK.familia(id)` na chave de queries.
- [ ] `useFamilia(familiaId, enabled)`: `useQuery` enabled=`enabled && !!familiaId`, `staleTime` 5min.

### Task 5: Front — `PainelAnalise` aceita `precoOverride` + `listingTypeReal`

**Files:**
- Modify: `src/components/painel-analise.tsx`
- Modify: `src/components/card-voce-recebe.tsx`

- [ ] `PainelAnalise` props opcionais `precoOverride?: number`, `listingTypeReal?: 'classico'|'premium'|null`.
- [ ] Preço usado = `precoOverride ?? precoPublicacao` (alimenta `SemaforoPreco` e `CardVoceRecebe`).
- [ ] `CardVoceRecebe` prop opcional `real?: 'classico'|'premium'|null`; passa `real` a cada `Coluna`
  (`real={real === 'classico'}` no Clássico, `real={real === 'premium'}` no Premium).
- [ ] `Coluna` prop `real?: boolean` → renderiza marcador "✓ publicado" (badge discreto) quando true.
- [ ] Sem `precoOverride`/`real` o comportamento atual permanece idêntico (Revisão intacta).

### Task 6: Front — linha expansível + selo Clássico/Premium

**Files:**
- Modify: `src/pages/Publicados.tsx` (`LinhaTabela`)

- [ ] `LinhaTabela` vira stateful (`const [aberto, setAberto] = useState(false)`).
- [ ] Botão chevron (toggle) no início da célula de título; `aria-expanded`, gira ao abrir.
- [ ] Selo Clássico/Premium (StatusPill compacto) na célula de título, abaixo do `codigoPai`;
  oculto/"—" quando `listingType` é null/undefined.
- [ ] Render: `<>` com a `TableRow` principal + (quando `aberto`) `TableRow` com `TableCell colSpan={11}`
  contendo o painel.
- [ ] `useFamilia(item.familiaId, aberto)`; enquanto carrega → "carregando análise…"; erro → mensagem;
  ok → `<PainelAnalise familia={fam} precoOverride={item.precoAtual ?? item.precoPublicacao}
  listingTypeReal={item.listingType ?? null} />`.

### Task 7: Verificação final

- [ ] `pnpm test` (935+ verdes).
- [ ] `pnpm build` limpo; `pnpm lint` nos arquivos tocados.
- [ ] Deploy CLI das edge functions afetadas pelo `_shared` (status-publicados + demais).
- [ ] Validação no browser (headless autenticado): expandir item → painel aparece; selo
  Clássico/Premium correto; marcador "✓ publicado" no card certo.
