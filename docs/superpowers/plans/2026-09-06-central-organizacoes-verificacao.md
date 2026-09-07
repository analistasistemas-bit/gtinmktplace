# Central de organizações — verificação local

Data: 2026-09-06. Branch: `codex/admin-control-20260906`. HEAD verificado antes desta
documentação: `50cb696e`.

Esta evidência é local. Nenhuma branch foi enviada, nenhuma migration foi aplicada em produção e
nenhuma Edge Function ou interface foi publicada.

## Ambientes

- Aplicação: worktree `admin-control-20260906`, dependências já disponíveis e `.env.local` como
  symlink para o checkout principal; valores não foram exibidos.
- PostgreSQL: contêiner Docker local `codex-platform-admin-test-20260906`, banco dedicado
  `codex_platform_admin_test_20260906`, porta limitada a `127.0.0.1:55436`.
- Navegador: Chromium isolado do `agent-browser`, sem estado de autenticação.

## Matriz

| Verificação | Estado | Evidência |
|---|---|---|
| Unitários T1–T7 e regressões Sonar | PASS | 17 arquivos, 125 testes |
| Deno: central e `usuarios` | PASS | 6 módulos conferidos |
| SQL comercial | PASS | PostgreSQL local, exit 0 |
| SQL Sonar | PASS | PostgreSQL local, exit 0 |
| SQL billing | PASS | PostgreSQL local, exit 0 |
| Concorrência de billing | PASS | script local, exit 0 |
| ESLint frontend T5–T7 | PASS | 19 arquivos, exit 0 |
| Integrações de produção usam módulos testados | PASS | imports/reexports conferidos |
| `tsc -b` | FAIL | 6 erros da baseline Sonar/faturamento |
| `pnpm build` | FAIL | interrompido pelos mesmos erros do `tsc -b` |
| `npm run db:check` | FAIL | worktree sem projeto Supabase linkado |
| Vite local | PASS | servidor iniciou com o symlink de ambiente |
| Central visual 390/1440 e teclado | SKIP | `/admin` redirecionou para `#/login`; navegador isolado sem sessão |
| Fluxo manual autenticado ponta a ponta | SKIP | sem fixture/login local de super-admin |
| Migration/deploy em produção | SKIP | fora do escopo e expressamente proibido |

## Comandos e resultados

### Testes unitários e de página

```bash
rtk proxy ./node_modules/.bin/vitest run \
  supabase/functions/_shared/platform-admin/__tests__/billing.test.ts \
  supabase/functions/_shared/platform-admin/__tests__/handler.test.ts \
  supabase/functions/_shared/platform-admin/__tests__/repository.test.ts \
  src/lib/__tests__/platform-admin.test.ts \
  src/lib/export/__tests__/platform-billing.test.ts \
  src/components/platform-admin/__tests__/org-billing.test.tsx \
  src/components/platform-admin/__tests__/commercial-terms-form.test.tsx \
  src/pages/__tests__/Organizacoes.test.tsx \
  src/pages/__tests__/OrganizacaoDetalhe.test.tsx \
  supabase/functions/_shared/platform-admin/__tests__/auth.test.ts \
  supabase/functions/_shared/platform-admin/__tests__/validation.test.ts \
  supabase/functions/_shared/platform-admin/__tests__/metrics-repository.test.ts \
  supabase/functions/_shared/platform-admin/__tests__/metrics-parity.test.ts \
  supabase/functions/_shared/pulse/__tests__/sonar-metering.test.ts \
  src/lib/__tests__/sonar.test.ts \
  src/lib/__tests__/sonar-buscas-recentes.test.ts \
  src/pages/__tests__/PulseSonar.test.tsx
```

Resultado: PASS, 17/17 arquivos e 125/125 testes em 14,17 s.

### Deno

```bash
rtk deno check \
  supabase/functions/_shared/platform-admin/handler.ts \
  supabase/functions/_shared/platform-admin/repository.ts \
  supabase/functions/_shared/platform-admin/billing.ts \
  supabase/functions/_shared/platform-admin/types.ts \
  supabase/functions/platform-admin/index.ts \
  supabase/functions/usuarios/index.ts
```

Resultado: PASS, exit 0. O comando atualizou `deno.lock` localmente; o arquivo não integra o commit
de documentação.

### PostgreSQL real local

Os três testes e as migrations correspondentes foram copiados com `rtk docker cp` para
`/tmp/platform-admin/{tests,migrations}` no contêiner dedicado. Em seguida:

```bash
rtk docker exec codex-platform-admin-test-20260906 \
  psql -U supabase_admin -d codex_platform_admin_test_20260906 \
  -v ON_ERROR_STOP=1 -f /tmp/platform-admin/tests/platform_commercial.sql
rtk docker exec codex-platform-admin-test-20260906 \
  psql -U supabase_admin -d codex_platform_admin_test_20260906 \
  -v ON_ERROR_STOP=1 -f /tmp/platform-admin/tests/platform_sonar.sql
rtk docker exec codex-platform-admin-test-20260906 \
  psql -U supabase_admin -d codex_platform_admin_test_20260906 \
  -v ON_ERROR_STOP=1 -f /tmp/platform-admin/tests/platform_billing.sql
rtk proxy ./scripts/test-platform-billing-concurrency.sh
```

Resultado: PASS nos quatro comandos. As fixtures cobrem isolamento A/B, condições versionadas,
preço por organização, cliente/Daludi, entrega e fechamento únicos sob concorrência, reabertura,
conciliação, revisão divergente, snapshot e ajustes tardios. O script de concorrência executa o
teste de billing no mesmo contêiner dedicado.

### ESLint

```bash
rtk pnpm exec eslint \
  src/App.tsx src/hooks/usePlatformAdmin.ts \
  src/lib/platform-admin.ts src/lib/__tests__/platform-admin.test.ts \
  src/lib/export/platform-billing.ts \
  src/lib/export/__tests__/platform-billing.test.ts \
  src/pages/Organizacoes.tsx src/pages/OrganizacaoDetalhe.tsx \
  src/pages/__tests__/Organizacoes.test.tsx \
  src/pages/__tests__/OrganizacaoDetalhe.test.tsx \
  src/components/platform-admin/commercial-terms-form.tsx \
  src/components/platform-admin/org-audit.tsx \
  src/components/platform-admin/org-billing.tsx \
  src/components/platform-admin/org-pulse.tsx \
  src/components/platform-admin/org-results.tsx \
  src/components/platform-admin/org-settings.tsx \
  src/components/platform-admin/revenue-reconciliation.tsx \
  src/components/platform-admin/__tests__/commercial-terms-form.test.tsx \
  src/components/platform-admin/__tests__/org-billing.test.tsx
```

Resultado: PASS, exit 0.

### TypeScript e build

```bash
rtk pnpm exec tsc -b --pretty false
rtk pnpm build
```

Resultado: FAIL nos dois comandos. O build parou em `tsc -b` e não chegou ao Vite. Erros
reproduzidos:

- fixtures sem `busca_id`, `resultado_id` e `consumo` em
  `src/components/pulse/__tests__/veredito-sonar.test.tsx`;
- três fixtures com o mesmo contrato incompleto em `src/lib/__tests__/sonar.test.ts`;
- fixture equivalente em `src/lib/__tests__/veredito-sonar.test.ts`;
- possível `null` em `src/lib/pedidos-faturamento.ts:136`.

Esses erros já constavam como baseline nas entregas T6/T7. Não foram alterados nesta tarefa de
documentação; portanto, esta branch não pode ser declarada pronta para merge.

### Histórico de migrations

```bash
rtk npm run db:check
rtk supabase migration list --linked
```

Resultado: FAIL. O segundo comando confirmou a causa: `Cannot find project ref. Have you run
supabase link?`. Nenhuma tentativa de link ou aplicação remota foi feita.

### Vite e navegador

```bash
rtk pnpm dev --host 127.0.0.1 --port 4173
rtk agent-browser --session task8 set viewport 390 844
rtk agent-browser --session task8 open http://127.0.0.1:4173/admin
rtk agent-browser --session task8 set viewport 1440 900
rtk agent-browser --session task8 open http://127.0.0.1:4173/admin
```

O Vite iniciou. Nos dois viewports, `/admin` redirecionou para `/admin#/login`; o navegador
isolado não possuía sessão autenticada. A tela de login carregou sem erro de console da aplicação,
mas a central, navegação por teclado e fluxo autenticado não foram visualmente aprovados. O Vite
também avisou que a fonte Geist, resolvida no `node_modules` externo ao worktree, estava fora da
allowlist de arquivos e usou fallback.

## Integrações conferidas no código

- `src/lib/resumo-vendas.ts`, `custos.ts`, `anuncio-canonico.ts` e `faturamento.ts` importam ou
  reexportam os núcleos compartilhados testados em `_shared/platform-admin`.
- `supabase/functions/platform-admin/index.ts` instancia o handler testado com
  `createPlatformAdminRepository(...)`.
- `src/pages/OrganizacaoDetalhe.tsx` importa e renderiza `OrgBilling` na aba Cobrança.

## Lacunas restantes

- Corrigir a baseline TypeScript e obter `pnpm build` verde.
- Linkar um ambiente Supabase autorizado e repetir `npm run db:check`; `db push` continua fora
  desta entrega.
- Executar 390/1440, teclado e fluxo ponta a ponta com um super-admin de fixture, sem dados de
  produção.
- Promover migrations, Edge Functions e frontend somente após aprovação e validação próprias de
  deploy.
- `delete_org` segue desabilitado; locks compartilhados do fechamento podem atrasar brevemente
  outros tenants; não há gateway nem cobrança retroativa.
