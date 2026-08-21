# Task 7 — Mercado relevante na Análise de Viabilidade

## Commit

- Base: `f56e2dec`
- Implementação: `092ec9b` — `feat: usar mercado relevante na Viabilidade`
- Fix round 1: `f5e0e96` — `fix: corrigir mercado relevante na Viabilidade` (base `21979d60`)
- Fix round 2: `110e573` — `fix: permitir retry no mercado relevante` (base `6a4ac5ea`)
- Deploy, push e merge: não executados.

## Fix round 1 — achados Important do Sol

### Red → Green

1. A chave ainda retornava `gtin:v4` e um payload legado sem `item_id`, `frete_gratis` e `full`
   permanecia acessível. O teste passou após o bump centralizado para `gtin:v5`, que torna o
   payload antigo um cache miss e o refaz.
2. O resolvedor ainda criava dois pools locais por item. O teste de cinco itens falhou sem
   `criarBuscasMercadoRelevante`; passou com uma única fila de seis slots e `Map<chave, Promise>`
   compartilhados por perfil (`seller_id`) e visitas (`item_id`).
3. A unidade de orquestração não era importável sem o handler Deno. Os testes passaram após
   extrair `analisarItemViabilidade` com dependências injetadas: sem relevante preserva observado
   e não chama listing/frete; com relevante chama duas listings e um frete com `70.19`, nunca `36`.
4. `tsc` reproduziu `TS18047` em `dialog-detalhe.test.tsx:197`; passou com narrowing explícito
   antes de `focus()`.

### Decisões

- `criarDependencias` é criado uma vez por request antes dos lotes e entrega a mesma camada de
  buscas a todos os `analisarItemViabilidade`; perfil e visitas dividem o limite global de seis.
- A chave GTIN continua centralizada em `chaveCacheGtin`, usada por leitura, tombstone e escrita;
  v5 cobre todas essas operações sem aceitar v4 incompleto.
- A orquestração extraída só executa listing price e frete após `mercado.menor != null`; o mercado
  observado permanece apenas informativo, sem fallback financeiro.
- Todas as queries de `pulse_produtos`, `pulse_ofertas_atual`, `pulse_vendedores` e `variacoes`
  mantêm o predicado `org_id`.

### Arquivos

- `supabase/functions/_shared/analise/analisar-item-viabilidade.ts`
- `supabase/functions/_shared/analise/__tests__/analisar-item-viabilidade.test.ts`
- `supabase/functions/_shared/analise/mercado-relevante.ts`
- `supabase/functions/_shared/analise/__tests__/mercado-relevante.test.ts`
- `supabase/functions/analisar-viabilidade/index.ts`
- `supabase/functions/_shared/concorrencia/cache-chave.ts`
- `supabase/functions/_shared/concorrencia/__tests__/cache-chave.test.ts`
- `src/components/pulse/__tests__/dialog-detalhe.test.tsx`

### Verificações

- Suíte Task 7 + Task 6 afetada: 9 arquivos / 88 testes aprovados.
- `rtk pnpm exec tsc -p tsconfig.app.json --pretty false`: aprovado.
- `rtk deno check ...`, `rtk pnpm run check:functions` e `rtk deno lint ...`: aprovados.
- `rtk pnpm run lint`: 0 erros; 12 warnings preexistentes fora do diff.
- `rtk git diff --check` e `rtk git diff --cached --check`: aprovados.

## Fix round 2 — retry e limiter global

### Red → Green

1. A primeira falha de perfil permanecia no `Map` e a segunda chamada recebia a mesma rejection.
   O teste passou após remover a entrada rejeitada somente quando ela ainda aponta para a mesma
   promise; perfil e visitas refazem a chamada e continuam deduplicados após sucesso (2 chamadas).
2. O teste anterior não sobrepunha perfil e visitas. O novo cenário mantém quatro visitas e seis
   perfis candidatos em voo entre cinco resoluções; passou com máximo global de seis. Dois limiters
   independentes iniciariam dez chamadas e falhariam no mesmo assert.

### Decisões

- O callback de rejeição compara a promise atual do `Map` antes de apagar a chave, evitando que uma
  rejection antiga elimine uma tentativa posterior.
- Promises resolvidas permanecem no `Map` pelo restante do request; não houve mudança de API ou UX.
- `deno.lock` foi inspecionado e não mudou, portanto não foi incluído.

### Arquivos

- `supabase/functions/_shared/analise/mercado-relevante.ts`
- `supabase/functions/_shared/analise/__tests__/mercado-relevante.test.ts`

### Verificações

- Testes focados: 2 arquivos / 9 testes aprovados.
- `rtk pnpm exec tsc -p tsconfig.app.json --pretty false`: aprovado.
- `rtk deno check ...`, `rtk pnpm run check:functions` e lint Deno direcionado: aprovados.
- `rtk git diff --check`: aprovado.

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
