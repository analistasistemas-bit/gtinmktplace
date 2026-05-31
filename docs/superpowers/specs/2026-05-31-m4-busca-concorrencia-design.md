# Spec — Busca de concorrência (M4)

**Data:** 2026-05-31
**Marco:** M4 — Integração Mercado Livre, bloco "Busca de concorrência"
**ADR:** [ADR-0014](../../decisions/0014-busca-de-concorrencia.md)
**Depende de:** [ADR-0008](../../decisions/0008-estrategia-de-preco-condicional.md) (consumidor),
[ADR-0012](../../decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) (`getValidAccessToken`)

---

## Objetivo e escopo

Para cada família, descobrir no Mercado Livre **quantos vendedores** concorrem e o **menor
preço**, persistir isso e classificar a concorrência. **Fora de escopo** (próximo bloco): o
cálculo do preço sugerido (ADR-0008) e os badges PRÓPRIO/COMPETITIVO na revisão. Este bloco
apenas **produz o dado** que aquele consome.

## Arquitetura

```
process-familia (após gerar copy)
   └─ buscarConcorrencia(familia)            _shared/ml/concorrencia.ts  (efeito: HTTP + cache)
        ├─ escolherIdentificador(familia)    _shared/concorrencia/identificador.ts  (puro)
        │    └─ gtinValido(gtin)             _shared/concorrencia/gtin.ts            (puro)
        ├─ cache Redis (get/set, TTL 6h)     _shared/redis/client.ts
        ├─ chamada à API ML  (getValidAccessToken, ADR-0012)
        ├─ parseResultadoBusca(json)         _shared/concorrencia/parse.ts           (puro)
        └─ classificarConcorrencia(n)        _shared/concorrencia/classificar.ts     (puro)
   └─ persiste em familias.*concorrencia*
```

> Nota: `_shared/concorrencia/pool.ts` já existe e é o pool de **paralelismo de chamadas**
> (Vision do M3) — sem relação com "concorrentes no ML". Os novos módulos puros ficam em
> `_shared/concorrencia/` e a busca com efeito em `_shared/ml/concorrencia.ts`.

## Componentes

### Funções puras (TDD — vitest)

| Função | Entrada | Saída | Regras |
|---|---|---|---|
| `gtinValido(gtin)` | `string\|null` | `boolean` | falso se nulo/vazio, começa com `3000`, ou não casa formato EAN (8/12/13/14 dígitos) |
| `escolherIdentificador(familia)` | família + variações | `{tipo:'gtin'\|'titulo', valor}` | 1ª variação com `gtinValido` → `gtin`; senão `titulo` = `nome_pai` |
| `classificarConcorrencia(vendedores)` | `number` | `'sem'\|'moderada'\|'alta'` | 0 → sem; 1–5 → moderada; ≥6 → alta |
| `parseResultadoBusca(json)` | resposta da API | `{vendedores:number, preco_min:number\|null}` | conta resultados/ofertas; menor preço; tolera payload vazio |

### Função com efeito

`buscarConcorrencia(familia, deps)` em `_shared/ml/concorrencia.ts`:
1. `escolherIdentificador(familia)`.
2. Monta a chave de cache (`cache:concorrencia:{gtin}` ou `cache:concorrencia:titulo:{hash}`);
   **cache hit** → retorna.
3. `getValidAccessToken(user_id)` (ADR-0012).
4. Chama a API ML:
   - `tipo='gtin'` → busca de produtos do catálogo por `product_identifier` (site MLB);
   - `tipo='titulo'` → `/sites/MLB/search?q={titulo}` (limitado aos N primeiros resultados).
5. `parseResultadoBusca` → `{vendedores, preco_min}`; `classificarConcorrencia`.
6. Resultado: `{vendedores, preco_min, origem:'gtin'|'titulo', classe}`; grava no cache (TTL 6h).
7. **Resiliência:** qualquer erro/timeout/429/vazio → `{vendedores:0, preco_min:null,
   origem:'nenhuma', classe:'sem'}` (não lança).

> Os campos exatos do JSON do ML (nome do array de resultados, caminho de `seller`/`price`)
> serão confirmados no bug bash com o token real; `parseResultadoBusca` isola esse acoplamento
> e é o único ponto a ajustar.

## Integração no `process-familia`

Após a geração da copy e antes de marcar a família como `pronta`:
- chamar `buscarConcorrencia(familia)` **1x**;
- persistir `concorrencia_vendedores`, `concorrencia_preco_min`, `concorrencia_origem`,
  `concorrencia_classe` na família;
- idempotência: preservada (o claim atômico de status do M2/M3 não muda); reprocessar uma
  família re-busca (ou usa cache se dentro de 6h).

## Modelo de dados

Migration aditiva em `familias` (ver ADR-0014): `concorrencia_vendedores`,
`concorrencia_preco_min`, `concorrencia_origem` enum, `concorrencia_classe` enum. Regenerar
tipos TypeScript do Supabase.

## Tratamento de erros do ML

| Situação | Ação |
|---|---|
| 401 (token) | `getValidAccessToken` renova e refaz; se persistir → "nenhuma" |
| 429 (rate limit) | trata como "nenhuma" e segue (cache reduz reincidência) |
| 4xx/5xx, timeout, JSON inesperado | "nenhuma" + log; não derruba a família |
| resultado vazio | "nenhuma" (legítimo: sem concorrência) |

## Testes

- **Unit (vitest):** as 4 funções puras, incluindo edge cases (`gtinValido` com `3000*`/nulo;
  `escolherIdentificador` quando nenhuma variação tem GTIN; `classificarConcorrencia` nos
  limiares 0/1/5/6; `parseResultadoBusca` com payload vazio e com várias ofertas).
- **Bug bash (manual, token real):** uma família com EAN real (espera achar catálogo) e uma só
  com código `3000*` (espera fallback título + baixa confiança); conferir contadores/menor preço.

## Critérios de saída (do TASKS.md)

- [ ] `buscarConcorrenciaPorGTIN` / por título (fallback) — via `buscarConcorrencia` + identificador
- [ ] Classificação (sem/moderada/alta)
- [ ] Cache `cache:concorrencia:*` no Redis (TTL 6h)
- [ ] Integração na edge function `process-familia`
- [ ] Migration + tipos regenerados
- [ ] Testes das funções puras verdes
