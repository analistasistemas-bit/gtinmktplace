# ADR-0059: Desconto sobre concorrência configurável

**Status:** Aceito
**Data:** 2026-07-04
**Decisores:** Diego

## Contexto

O ADR-0020 fixou o percentual de desconto aplicado ao preço quando há concorrente
(`preço_venda = menor_concorrente × 0,95`) como valor hardcoded, registrando
explicitamente no "Escopo e guardas" que era "config futura".

## Decisão

O percentual passa a ser um parâmetro por usuário, salvo em `configuracoes.desconto_concorrencia_pct`
(numeric, default 5), editável no menu Configurações (mesmo padrão de "Desconto de marketing"
e "Imposto por origem": `Input` numérico + salvamento no `onBlur`).

`sugerirPrecoVenda` (`supabase/functions/_shared/preco/sugerir.ts`) ganha um 6º parâmetro
posicional opcional `descontoConcorrenciaPct` (default 5, preserva comportamento anterior
para chamadas existentes/testes). `process-familia` lê a coluna junto com as alíquotas
(mesma query) e passa o valor nas duas chamadas de `sugerirPrecoVenda`.

## Como reverter

Remover a coluna `desconto_concorrencia_pct`, o card em `Configuracoes.tsx` e voltar o
6º parâmetro de `sugerirPrecoVenda` para o literal `0.95`.
