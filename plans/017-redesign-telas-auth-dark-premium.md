# Plan 017: Redesign das telas de auth — dark premium / glass

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Este plano é para revisão do Diego antes de qualquer execução; a implementação
> será feita por outro executor (Sonnet 5) numa sessão separada.**
>
> **Drift check (run first)**: confira que `src/pages/Login.tsx`, `src/pages/ResetSenha.tsx`
> e `src/pages/DefinirSenha.tsx` ainda batem com a seção "Current state" abaixo
> (card em `bg-muted/30`, logo `h-9 w-9`, estados `carregando`/`feito`/`salvando`).
> Divergência relevante = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (camada visual/motion; zero mudança de lógica de auth; zero dependência nova)
- **Depends on**: nenhuma (motion tokens ADR-0079 já em produção)
- **Category**: UI/brand
- **Planned at**: 2026-07-19

## Contexto / motivação

As telas `/login`, `/reset-senha` e `/definir-senha` são o ponto de entrada do SaaS e hoje
são um card genérico em `bg-muted/30` — visual de protótipo, não de produto. Este plano
eleva as 3 telas para um visual "dark premium / glass" (mood Linear/Raycast): fundo quase
preto, logo-hero com glow de marca acima de um card discreto com glassmorphism leve, e duas
animações CSS (cascata de entrada + sucesso no submit). É percepção de marca no primeiro
contato — nenhuma mudança de comportamento, copy ou fluxo.

## Decisões travadas (não renegociar)

1. As 3 telas recebem o mesmo tratamento, via shell compartilhado (`AuthShell`).
2. Estrutura mantida: um card centralizado; sem split-screen, sem painel de features.
   Lógica funcional 100% intacta (`signIn`, `sendPasswordReset`, `verifyOtp`/`updateUser`).
3. Logo vira hero acima do card (bem maior que `h-9`), com glow de marca atrás.
4. **Sempre dark**: as 3 telas ignoram o tema salvo do usuário (ADR-0080, passo 0).
5. Estilo contido: glow sutil e localizado, textura discreta, glass leve. Nada de
   gradiente dominante/template de landing.
6. Motion #1: entrada em cascata — logo primeiro, card em sequência (stagger em token).
7. Motion #2: sucesso no submit — botão → check + card fade-out (~300ms) antes de navegar.
   No reset (sem navegação), sucesso = botão + entrada do texto.
8. Motion CSS-only com os tokens existentes; respeitar `prefers-reduced-motion`.
9. Responsivo: logo/tipografia escalam em mobile.
10. Zero copy nova — todos os textos existentes permanecem byte a byte.
11. ADR-0080 criado antes de qualquer código.

## Current state

- `src/pages/Login.tsx` — wrapper `flex min-h-screen items-center justify-center bg-muted/30 p-4`,
  `Card max-w-sm p-6`, `<Logo symbolClassName="h-9 w-9" />` + caption "Publicação de anúncios
  para Marketplaces", form email/senha, botão `carregando ? 'Entrando…' : 'Entrar'`,
  link "Esqueci a senha". `finally { setCarregando(false) }`.
- `src/pages/ResetSenha.tsx` — mesmo wrapper/card, `<h1 class="text-h1">Recuperar senha</h1>`
  (sem logo), form email, botão "Enviar" **sem estado de loading**, sucesso = `feito` →
  texto "Se a conta existir, você receberá um e-mail com as instruções.", link "Voltar ao login".
- `src/pages/DefinirSenha.tsx` — mesmo wrapper/card, logo `h-9` + caption "Defina sua senha
  de acesso", 3 estados: erro de link / "Validando link…" / form com botão
  `salvando ? 'Salvando…' : 'Definir senha e entrar'`; sucesso → `navigate('/', { replace: true })`.
- `src/components/ui/logo.tsx` — `Logo` aceita `className`, `symbolClassName`, `showWordmark`;
  wordmark hardcoded `text-base`. `LogoSymbol` = SVG stroke com gradiente via `useId`.
- `src/index.css` — tokens dark em `.dark {}` (`--background: oklch(0.14 0.012 277)`,
  `--card: oklch(0.265 …)`, `--border: oklch(1 0 0 / 0.20)`, `--brand-gradient`,
  `--brand-gradient-soft`, `--brand-glow` → utilitário `shadow-brand`); variant
  `@custom-variant dark (&:is(.dark *))`; bloco global `prefers-reduced-motion` zera
  `animation-duration`/`transition-duration` (não zera `animation-delay` — ver Step 3).
- `src/motion/motion.css` (GERADO — não editar): `--motion-duration-{instant,micro,state,enter,overlay,page}`
  (100/150/190/260/300/320ms), `--motion-distance-enter-y: 8px`, easings
  `--motion-ease-{enter,exit,reversible,success}`. TS: `src/motion/tokens.ts` exporta
  `durationMs` (ex.: `durationMs.overlay === 300`).
- `tw-animate-css` instalado e já usado no app (`animate-in fade-in slide-in-from-bottom-* zoom-in-*`
  em `src/pages/*` e `src/components/ui/*`). `lucide-react` instalado (`Check` já usado em
  `src/components/stepper.tsx`).
- Convenção de componentes: flat kebab-case em `src/components/` (`app-shell.tsx`, `admin-shell.tsx`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `pnpm lint` | 0 errors |
| Typecheck | `pnpm exec tsc -b` | exit 0 |
| Test | `pnpm test` | todos passam (inclui drift test de motion) |
| Build | `pnpm build` | build ok |
| Dev | `pnpm dev` (copiar `.env.local` para o worktree antes) | app abre, não fica branca |

## Scope

**In scope**:
- `docs/decisions/0080-telas-auth-sempre-dark.md` (criar — conteúdo pronto no Step 0)
- `src/components/auth-shell.tsx` (criar)
- `src/components/ui/logo.tsx` (adicionar prop opcional `wordmarkClassName` — additive)
- `src/index.css` (classe `.auth-grid` + `animation-delay` no bloco reduced-motion)
- `src/pages/Login.tsx`, `src/pages/ResetSenha.tsx`, `src/pages/DefinirSenha.tsx`
- `obsidian-vault/` + `docs/` conforme tabela do CLAUDE.md (ADR novo → índice de ADRs)

**Out of scope** (não tocar):
- `src/motion/motion.css` / `tokens.ts` / `easings.ts` (nenhum token novo é necessário)
- `theme-provider.tsx`, `theme-toggle.tsx`, qualquer rota fora das 3
- `src/lib/auth.ts`, `src/lib/supabase.ts` — zero mudança de lógica de auth
- Copy: nenhum texto novo; textos existentes permanecem exatamente iguais
- Dependências: nenhuma nova

## Git workflow

- Worktree isolado (este). Commit ex.: `feat(auth): redesign dark premium das telas de auth (#017, ADR-0080)`
- NÃO push/PR sem o operador pedir. Diego valida localmente antes de commit.

---

## Steps

### Step 0: Criar ADR-0080 (ANTES de qualquer código)

Salvar o conteúdo abaixo, integral, em `docs/decisions/0080-telas-auth-sempre-dark.md`,
e adicionar a linha correspondente em `obsidian-vault/04-Decisões/Índice de ADRs.md`.

```markdown
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
```

Verify: arquivo existe; `docs/decisions/README.md` (se tiver índice) e
`obsidian-vault/04-Decisões/Índice de ADRs.md` referenciam ADR-0080.

### Step 1: Prop `wordmarkClassName` em `logo.tsx`

Em `src/components/ui/logo.tsx`, adicionar ao `LogoProps` a prop opcional
`wordmarkClassName?: string` e aplicá-la no `<span>` do wordmark via
`cn('text-base font-semibold leading-none tracking-tight', wordmarkClassName)`.
Mudança additive — nenhum caller existente muda.

Verify: `pnpm exec tsc -b` ok; app renderiza logo do sidebar/topbar igual a antes.

### Step 2: Criar `src/components/auth-shell.tsx`

Componente único, sem subpasta (convenção flat kebab-case, como `app-shell.tsx`).

**API:**

```tsx
interface AuthShellProps {
  /** Linha sob a logo hero (ex.: "Publicação de anúncios para Marketplaces"). */
  subtitle?: string;
  /** true → card anima fade-out (usado no sucesso antes de navegar). */
  saindo?: boolean;
  /** Conteúdo do card — form/estados específicos de cada página. */
  children: React.ReactNode;
}
export function AuthShell({ subtitle, saindo, children }: AuthShellProps)
```

**Estrutura (JSX de referência — seguir fielmente as classes):**

```tsx
<div
  className="dark relative flex min-h-screen flex-col items-center justify-center
             overflow-hidden bg-background p-4 text-foreground"
  style={{ colorScheme: 'dark' }}
>
  {/* Textura: grid fino, esvanecendo nas bordas (classe no Step 3) */}
  <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />

  {/* Hero: logo + glow + subtítulo — anima primeiro (Motion #1) */}
  <div className="relative z-10 mb-8 flex flex-col items-center gap-3
                  animate-in fade-in zoom-in-95 duration-(--motion-duration-page)
                  ease-enter fill-mode-both">
    <div aria-hidden className="absolute -inset-x-20 -inset-y-12 -z-10 rounded-full
                                bg-[image:var(--brand-gradient-soft)] opacity-50 blur-3xl" />
    <Logo className="gap-3" symbolClassName="h-14 w-14 sm:h-16 sm:w-16"
          wordmarkClassName="text-2xl sm:text-3xl" />
    {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
  </div>

  {/* Card glass — entra em sequência (stagger) e sai no sucesso (Motion #2) */}
  <Card
    className={cn(
      'z-10 w-full max-w-sm border-border/60 bg-card/60 p-6 shadow-lg backdrop-blur-xl',
      saindo
        ? 'animate-out fade-out slide-out-to-top-2 duration-(--motion-duration-overlay) ease-exit fill-mode-forwards'
        : 'animate-in fade-in slide-in-from-bottom-2 duration-(--motion-duration-enter) ease-enter delay-(--motion-duration-micro) fill-mode-both',
    )}
  >
    {children}
  </Card>
</div>
```

Notas de implementação:
- **Dark forçado**: a classe `dark` no wrapper faz `var(--background)` etc. resolverem os
  valores do bloco `.dark {}` (custom properties aplicam ao próprio elemento) e o variant
  `dark:` valer para os descendentes. `colorScheme: 'dark'` cobre autofill/controles
  nativos. Nada de mexer no ThemeProvider (ADR-0080).
- **Fundo**: `bg-background` dark (oklch 0.14 ≈ quase preto). Não inventar valor mais
  escuro — token existente.
- **Glow do hero**: `--brand-gradient-soft` + `blur-3xl` + `opacity-50`. Se ficar forte
  demais no visual real, reduzir para `opacity-40` — não passar disso nem adicionar um
  segundo glow atrás do card (contenção > excesso).
- **Stagger (Motion #1)**: hero `duration-page` (320ms) sem delay; card `duration-enter`
  (260ms) com `delay-(--motion-duration-micro)` (150ms — 1 token, não número mágico).
  `fill-mode-both` mantém o card invisível durante o delay.
- **Mobile**: logo `h-14`/wordmark `text-2xl` em <640px, `h-16`/`text-3xl` em `sm:`.
  Card já é `w-full max-w-sm` + `p-4` no wrapper — nada mais a fazer.

Verify: `pnpm exec tsc -b` ok.

### Step 3: CSS de suporte em `src/index.css` (NÃO tocar em `motion.css`)

3a. Adicionar em `@layer components` (junto de `.track-indeterminate`):

```css
/* Grid fino das telas de auth (plano 017) — esvanece radialmente p/ não virar wallpaper */
.auth-grid {
  background-image:
    linear-gradient(oklch(1 0 0 / 0.03) 1px, transparent 1px),
    linear-gradient(90deg, oklch(1 0 0 / 0.03) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 70% 55% at 50% 38%, black, transparent);
}
```

3b. No bloco global `@media (prefers-reduced-motion: reduce)` já existente, acrescentar
`animation-delay: 0.01ms !important;` à regra `*, *::before, *::after` (hoje ela zera só
duration). Sem isso, o card com `fill-mode-both` ficaria invisível 150ms sob reduced
motion. Zerar delays sob reduced motion é o comportamento correto para o app todo
(staggers viram aparição imediata) — é ajuste no mecanismo global, não hack local.

Verify: `pnpm test` (drift test de motion continua passando — nada em `motion.css` mudou).

### Step 4: Migrar `Login.tsx`

- Substituir wrapper+card por `<AuthShell subtitle="Publicação de anúncios para Marketplaces" saindo={sucesso}>`.
  O bloco logo+caption sai do card (o shell renderiza ambos); o card contém só form + link.
- Novo estado `const [sucesso, setSucesso] = useState(false)`.
- No `onSubmit`, trocar a navegação imediata por sucesso animado (Motion #2):

```tsx
import { durationMs } from '@/motion/tokens';
import { Check } from 'lucide-react';

// dentro do try, após await signIn(...):
setSucesso(true);
const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
setTimeout(() => nav(dest, { replace: true }), reduz ? 0 : durationMs.overlay);
```

- Botão (textos existentes intactos; check só no sucesso):

```tsx
<Button type="submit" disabled={carregando || sucesso}
        className={sucesso ? 'shadow-brand' : undefined}>
  {sucesso
    ? <Check aria-label="Sucesso" className="animate-in zoom-in-50 duration-(--motion-duration-state) ease-success" />
    : carregando ? 'Entrando…' : 'Entrar'}
</Button>
```

- Total de latência adicionada no sucesso: 300ms (`durationMs.overlay`) — dentro do
  budget 300–500ms; 0ms sob reduced motion. Nenhum outro delay artificial.

Verify: `pnpm exec tsc -b`; login manual em dev — cascata na entrada, check + fade-out no
sucesso, erro de senha continua aparecendo em vermelho sem animação de sucesso.

### Step 5: Migrar `DefinirSenha.tsx`

Mesmo padrão do Step 4:
- `<AuthShell subtitle="Defina sua senha de acesso" saindo={sucesso}>`.
- Os 3 estados internos (erro de link / "Validando link…" / form) ficam como `children`,
  textos intactos.
- Em `salvar`, no caminho de sucesso: `setSucesso(true)` + `setTimeout(() =>
  navigate('/', { replace: true }), reduz ? 0 : durationMs.overlay)`.
- Botão: `sucesso ? <Check …ease-success/> : salvando ? 'Salvando…' : 'Definir senha e entrar'`,
  `disabled={salvando || sucesso}`, `shadow-brand` no sucesso.

Verify: `pnpm exec tsc -b`; rota com `token_hash` inválido mostra o erro dentro do card
glass; sem token mostra "Link inválido ou expirado.".

### Step 6: Migrar `ResetSenha.tsx`

- `<AuthShell>` **sem** `subtitle` e **sem** `saindo` (não há navegação — decisão 7):
  o `<h1 className="mb-4 text-h1">Recuperar senha</h1>` permanece dentro do card.
- Novos estados: `enviando` e `sucesso`. Em `onSubmit`:

```tsx
setEnviando(true);
try {
  await sendPasswordReset(email);
  setSucesso(true);
  const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => setFeito(true), reduz ? 0 : durationMs.overlay);
} catch (err) { … como hoje … } finally { setEnviando(false); }
```

- Botão: texto continua "Enviar" (nenhuma copy nova); `disabled={enviando || sucesso}`;
  no `sucesso`, mostra o `<Check …ease-success/>` + `shadow-brand`, como nos Steps 4/5.
- Bloco de sucesso (`feito`): texto existente intacto, entrando com
  `className="text-sm animate-in fade-in slide-in-from-bottom-2 duration-(--motion-duration-enter) ease-enter"`.
- Link "Voltar ao login" permanece.

Verify: `pnpm exec tsc -b`; fluxo manual — Enviar → check no botão → texto de sucesso
entra suave; erro de rede mostra "Falha ao enviar e-mail".

### Step 7: Documentação e fechamento

- `docs/`: conferir se algum doc referencia as telas de auth (provável nenhum além do ADR);
  atualizar `obsidian-vault/` se houver nota de UI/fluxo de login.
- Atualizar `docs/TASKS.md` e linha de status em `plans/README.md`.
- Reportar explicitamente: documentação atualizada ou conferida sem necessidade.

---

## STOP conditions

- Drift check falhou (páginas divergem do "Current state").
- `pnpm test` falha **antes** de qualquer mudança (baseline quebrado — não é deste plano).
- As utilities de motion não aplicarem a animação: verificar no DevTools que o card tem
  `animation-delay: 150ms` e `animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1)`
  computados. Se `delay-(--motion-duration-micro)` ou `ease-enter` **não** afetarem a
  animação do `animate-in` (semântica do tw-animate-css), STOP e reportar — o fallback
  aprovado é declarar em `src/index.css` classes `.auth-hero-enter` / `.auth-card-enter` /
  `.auth-card-exit` com `@keyframes` próprios consumindo os mesmos tokens
  (`var(--motion-duration-*)`, `var(--motion-ease-*)`, `var(--motion-distance-enter-y)`),
  mas só implementar após reportar.
- Qualquer necessidade de tocar `motion.css`/`tokens.ts` ou instalar dependência = STOP
  (o plano por definição não precisa de nenhum token novo).
- Qualquer texto visível precisar mudar = STOP (decisão 10).

## Critério de pronto / QA

Automático:
- [ ] `pnpm lint` — 0 errors
- [ ] `pnpm exec tsc -b` — exit 0
- [ ] `pnpm test` — verde (incl. drift test de motion intacto)
- [ ] `pnpm build` — ok

Manual (dev server, as 3 rotas `/login`, `/reset-senha`, `/definir-senha`):
- [ ] Visual dark premium: fundo quase preto, glow sutil só atrás da logo, grid discreto,
      card glass (blur + borda translúcida). Nada saturado/genérico.
- [ ] **Com tema salvo em light**: as 3 telas continuam dark; ao logar, o app interno abre
      no tema light salvo (override não vazou — checar dashboard, sidebar, toggle).
- [ ] Motion #1: logo anima primeiro, card entra ~150ms depois, subindo 8px — sequência
      perceptível, não simultânea.
- [ ] Motion #2: login com credenciais válidas → check no botão + fade-out do card antes
      do redirect (~300ms, sem sensação de travamento). Idem definir-senha. No reset,
      check + entrada suave do texto de sucesso, sem navegação.
- [ ] Estados de erro das 3 telas intactos (senha errada, e-mail com falha, link inválido,
      "Validando link…").
- [ ] Todos os textos idênticos aos atuais (diff visual 1:1 com o Current state).
- [ ] `prefers-reduced-motion: reduce` (DevTools → Rendering → emulate): nenhuma animação,
      nenhum elemento invisível/atrasado, navegação de sucesso imediata.
- [ ] Mobile 375px: logo `h-14`/`text-2xl`, card confortável, sem overflow horizontal.
- [ ] Inputs legíveis em dark incluindo autofill do navegador (color-scheme aplicado);
      focus ring visível ao navegar por teclado.
- [ ] Validação de UI de fim de branch conforme prática do projeto (ultraqa/browser-use)
      antes de commit.
