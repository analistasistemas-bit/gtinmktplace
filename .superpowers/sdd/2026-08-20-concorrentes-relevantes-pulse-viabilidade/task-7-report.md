# Task 7 — Mercado relevante na Análise de Viabilidade

## Commit

- Base: `f56e2dec`
- Implementação: `092ec9b` — `feat: usar mercado relevante na Viabilidade`
- Deploy, push e merge: não executados.

## Red → Green

1. `mercado-relevante.test.ts` falhou porque o resolvedor não existia; passou com mercado
   relevante/observado, snapshot seguro, falhas honestas, deduplicação e pool de seis.
2. `viabilidade-linha-mercado.test.tsx` falhou porque a linha acessava comissão inexistente e
   mostrava contagem bruta; passou com estado sem relevante, travessões e menor observado no detalhe.
3. O teste de perfil fresco falhou ao deixar um snapshot legado posterior substituir o perfil
   ordenado; passou ao preservar a primeira linha por vendedor retornada pela query Pulse.

## Decisões

- `Mercado` tem o mesmo contrato no servidor e navegador, com `ofertas` e `observado`.
- O resolvedor usa exclusivamente `resumirMercadoQualificado` da Task 1; o observado nunca é
  fallback financeiro.
- Snapshot Pulse só é usado com `org_id`, `catalog_product_id` e idade máxima de 24 horas.
  Perfil e visitas vencidos/ausentes são preenchidos uma vez por vendedor/item, em pool máximo 6.
- `analisarItem` devolve `existeNoML: true` mesmo sem relevante e só consulta listing price/frete
  depois de `mercado.menor != null`.
- A interface usa “Menor relevante”, `X de Y`, “Sem concorrente relevante”, travessões e mantém o
  menor observado apenas como detalhe.

## Arquivos

- `supabase/functions/_shared/analise/tipos.ts`
- `supabase/functions/_shared/analise/mercado-relevante.ts`
- `supabase/functions/_shared/analise/__tests__/mercado-relevante.test.ts`
- `supabase/functions/analisar-viabilidade/index.ts`
- `src/lib/viabilidade.ts`
- `src/components/viabilidade-linha.tsx`
- `src/components/__tests__/viabilidade-linha-mercado.test.tsx`
- `src/components/__tests__/viabilidade-linha-cadastrar.test.tsx`
- `src/pages/Viabilidade.tsx`

## Verificações

- `rtk pnpm exec vitest run supabase/functions/_shared/analise/__tests__/mercado-relevante.test.ts src/lib/__tests__/analise-viabilidade.test.ts src/components/__tests__/viabilidade-linha-mercado.test.tsx src/components/__tests__/viabilidade-linha-cadastrar.test.tsx`: 23 testes aprovados.
- `rtk pnpm run check:functions`: aprovado, incluindo `mercado-relevante.ts`.
- `rtk deno lint …`: aprovado.
- `rtk pnpm exec eslint …` nos arquivos frontend alterados: aprovado.
- `rtk git diff --check` e `rtk git diff --cached --check`: aprovados.
- `rtk pnpm exec tsc -p tsconfig.app.json --pretty false`: bloqueado por erro pré-existente fora
  deste diff em `src/components/pulse/__tests__/dialog-detalhe.test.tsx:197` (`resumo` possivelmente nulo).
