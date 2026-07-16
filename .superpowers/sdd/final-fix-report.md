# Relatório das correções da revisão final

## Status

Implementação concluída em TDD estrito, sem deploy, migration ou remediação operacional.

Commit da implementação: `79145a78c0f6596bedf90572fdecadf72730b46b` (`fix: harden catalog retry decisions`).

## RED

Comando inicial:

```bash
rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/catalogo.test.ts supabase/functions/_shared/notificacoes/__tests__/catalogo-nomatch.test.ts supabase/functions/vincular-catalogo/__tests__/decisao.test.ts
```

Saída esperada observada: exit 1; 5 falhas e 48 testes passando. As quatro tentativas inválidas falharam porque `normalizarTentativaCatalogo` ainda não existia; a mensagem estrutural falhou porque ainda dizia `não tem ficha equivalente`.

Após tornar explícita a seleção do motivo pelo resumo, novo RED direcionado:

```bash
rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/catalogo.test.ts
```

Saída esperada observada: exit 1; 1 falha e 41 testes passando. A falha foi `decidirMotivoAlertaCatalogo is not a function`.

Os testes da política mista já passaram no RED, documentando e congelando o comportamento existente aprovado.

## GREEN

Comando final direcionado:

```bash
rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/catalogo.test.ts supabase/functions/_shared/notificacoes/__tests__/catalogo-nomatch.test.ts supabase/functions/vincular-catalogo/__tests__/decisao.test.ts
```

Saída: exit 0; 3 arquivos passaram, 54/54 testes passaram, 0 falhas.

Validação adicional:

```bash
rtk git diff --check
```

Saída: exit 0, sem erros de whitespace.

## Arquivos alterados

- `supabase/functions/_shared/ml/catalogo.ts`
- `supabase/functions/_shared/ml/__tests__/catalogo.test.ts`
- `supabase/functions/_shared/notificacoes/telegram.ts`
- `supabase/functions/_shared/notificacoes/__tests__/catalogo-nomatch.test.ts`
- `supabase/functions/vincular-catalogo/index.ts`
- `supabase/functions/vincular-catalogo/__tests__/decisao.test.ts`

## Decisões

- Uma única função `normalizarTentativaCatalogo` aceita somente inteiros em `1..CATALOGO_MAX_TENTATIVAS`; qualquer outro valor vira 1. O worker e a função pura usam a mesma regra, impedindo índice de backoff fora da faixa.
- `pendente` continua com prioridade absoluta.
- `sem_variation_id` isolado recebe o motivo `sem_variation_id` e texto estrutural próprio, sem alegar múltiplas tentativas.
- `nao_elegivel` esgotado mantém `elegibilidade_esgotada`; ficha divergente/sem produto mantêm o texto padrão.
- Resumos mistos com `nao_elegivel + sem_variation_id` ou `nao_elegivel + ficha_divergente` continuam reagendando enquanto houver tentativa e finalizam com alerta ao esgotar.
- Nenhuma documentação foi alterada: os ADRs existentes já descrevem a política e os novos testes a tornam inequívoca.

## Self-review

Diff revisado integralmente. Não foram encontrados desvios de escopo, duplicação de validação, alteração na prioridade de `pendente` ou acesso possível ao backoff fora da faixa. O diretório não rastreado `node_modules` já presente no worktree foi preservado e não entrou no commit.
