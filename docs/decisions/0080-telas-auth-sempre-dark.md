# ADR-0080: Telas de autenticação sempre renderizam em dark, sobrepondo o tema salvo

**Status:** Aceito
**Data:** 2026-07-19
**Decisores:** Diego (entrevista de design) + Claude (plano 017)

## Contexto

O app tem toggle light/dark persistido (`src/components/theme-provider.tsx`, classe `.dark`
no root). O redesign das telas de auth (`/login`, `/reset-senha`, `/definir-senha` — plano
017) adota visual "dark premium / glass" com glow de marca, cujo impacto depende de fundo
quase preto: a mesma composição em light perde o contraste do glow e vira um card claro
genérico. As telas de auth antecedem a sessão — o usuário ainda nem "entrou" no app cujo
tema ele configurou.

## Decisão

As 3 telas de auth renderizam **sempre em dark**, independentemente do tema salvo do
usuário. Implementação: o wrapper raiz do `AuthShell` (`src/components/auth-shell.tsx`)
aplica a classe `.dark` localmente (+ `color-scheme: dark` inline para controles nativos
e autofill). Nenhuma mudança no `ThemeProvider`, no toggle ou na persistência — dentro do
app autenticado o tema salvo continua valendo integralmente. Trade-off consciente:
impacto visual no ponto de entrada > consistência com o toggle.

## Alternativas consideradas

- **Respeitar o tema salvo também no auth:** rejeitada — em light o conceito visual
  aprovado (glow sobre quase-preto, glass) não se sustenta; manteria o visual de
  protótipo em metade dos casos.
- **Forçar dark no `<html>` durante as rotas de auth (via ThemeProvider/effect):**
  rejeitada — mexe em estado global, cria flash de tema na navegação auth→app e acopla
  o ThemeProvider a rotas. A classe local no wrapper tem o mesmo efeito visual sem
  nenhum estado.
- **Duplicar tokens "auth-dark" próprios:** rejeitada — segunda nomenclatura para os
  mesmos valores; os tokens de `.dark` em `src/index.css` já são a fonte única.

## Consequências

- Usuário com tema light vê transição dark→light ao logar. Aceito (transição de contexto
  natural, mesmo padrão de Linear/Raycast/Vercel).
- Os tokens de `.dark` passam a ter um consumidor fora do toggle; mudanças neles afetam
  também o auth (desejável — fonte única).
- Qualquer tela futura de auth/onboarding pré-sessão deve usar o `AuthShell` e herda a
  decisão.
