# Padrão único de estados de espera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao operador um sinal visual único e previsível de "está processando, aguarde" em todas as 37 janelas e botões do PubliAI onde ele hoje clica e espera sem retorno.

**Architecture:** A mecânica dos dois efeitos que já existem (`.glow-effect-sombra` e `.track-indeterminate`) vai para uma prop `processando` em `DialogContent`/`AlertDialogContent`, em vez de ser copiada em cada tela. Ação destrutiva e botão fora de modal recebem só a barra. Sete confirmações que hoje desmontam antes da operação terminar passam a ficar abertas até resolver, via handler `async` e `preventDefault` no `AlertDialogAction`.

**Tech Stack:** React 19, TypeScript, Radix UI (`radix-ui` pacote único), Tailwind v4, TanStack Query, Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-09-17-padrao-estados-espera-design.md`](../specs/2026-09-17-padrao-estados-espera-design.md)
**Inventário:** [`docs/superpowers/specs/2026-09-17-inventario-estados-espera.md`](../specs/2026-09-17-inventario-estados-espera.md)

## Global Constraints

- **Nenhuma chamada de mutation, edge function ou RPC é alterada.** O trabalho mexe em ciclo de vida de modal e em sinalização visual. Se uma tarefa parecer exigir mudar o que é enviado ao Mercado Livre, pare e reporte.
- **Nunca editar anúncio publicado no ML fora do fluxo do app**, nem em diagnóstico.
- **Proibido progresso determinístico** para operação indeterminada: sem percentual simulado, sem etapa por `setTimeout` (contrato de motion §9, regra 6).
- **Ação destrutiva não leva glow** (contrato de motion §10). Só a barra.
- Os guards de `prefers-reduced-motion` e `forced-colors` já existentes nos dois efeitos **devem continuar funcionando**. Não tocar neles.
- Idioma do código e dos rótulos: português, com acentuação correta. Nomes de prop em português, seguindo o código existente (`salvando`, `publicando`, `enviando`).
- Testes vivem em **duas árvores**: `src/**/__tests__/` e `tests/`. Ao triar falhas, cobrir as duas.
- Portão de pré-push: `pnpm preflight:static`. Build local não reproduz o CI — não remontar o checklist à mão.
- Commits frequentes, um por tarefa.

---

## Estrutura de arquivos

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `src/components/ui/progresso-indeterminado.tsx` | A barra como componente, com `role`/`aria-label` corretos. Usada pelos modais e pelos botões soltos. |
| `src/components/ui/__tests__/dialog-processando.test.tsx` | Suíte da mecânica: prop `processando`, prop `destrutivo`, estado ocioso, acessibilidade. Cobre `DialogContent` e `AlertDialogContent`. |

**Modificados (mecânica):**

| Arquivo | O quê |
|---|---|
| `src/components/ui/dialog.tsx` | Props `processando`/`destrutivo` no `DialogContent`; import do `glow-effect.css` passa a morar aqui |
| `src/components/ui/alert-dialog.tsx` | Mesmas props no `AlertDialogContent` |

**Modificados (aplicação):** 18 modais do Grupo A, 7 do Grupo B, 3 do Grupo C, 9 botões do Grupo D — listados por tarefa.

---

## Task 1: Componente da barra indeterminada

**Files:**
- Create: `src/components/ui/progresso-indeterminado.tsx`
- Test: coberto pela suíte da Task 3 (o componente é trivial e só existe para centralizar os atributos ARIA)

**Interfaces:**
- Consumes: a classe `.track-indeterminate`, já definida em `src/index.css:217`. Não criar CSS novo.
- Produces: `<ProgressoIndeterminado label={string} className?={string} />`

- [ ] **Step 1: Criar o componente**

```tsx
// src/components/ui/progresso-indeterminado.tsx
import { cn } from "@/lib/utils"

// A classe `.track-indeterminate` mora em src/index.css. Este componente existe só para que
// `role` e `aria-label` não sejam reescritos — e esquecidos — em cada lugar que mostra espera.
export function ProgressoIndeterminado({
  label,
  className,
}: {
  /** O que está acontecendo, na voz do sistema: "Enfileirando publicação". Nunca "Carregando". */
  label: string
  className?: string
}) {
  return (
    <div
      className={cn("track-indeterminate", className)}
      role="progressbar"
      aria-label={label}
    />
  )
}
```

- [ ] **Step 2: Verificar que compila**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: sem erro novo. (Se o projeto já tiver erros pré-existentes, compare com `origin/main` antes de atribuí-los a esta mudança.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/progresso-indeterminado.tsx
git commit -m "feat(ui): componente da barra de progresso indeterminado"
```

---

## Task 2: Prop `processando` no DialogContent e no AlertDialogContent

**Files:**
- Modify: `src/components/ui/dialog.tsx` (função `DialogContent`, hoje nas linhas 52-89)
- Modify: `src/components/ui/alert-dialog.tsx` (função `AlertDialogContent`, hoje nas linhas 49-70)

**Interfaces:**
- Consumes: `ProgressoIndeterminado` da Task 1.
- Produces:
  - `DialogContent` ganha `processando?: boolean`, `destrutivo?: boolean`, `rotuloProcessando?: string`
  - `AlertDialogContent` ganha exatamente as mesmas três props
  - Contrato: `processando` liga `aria-busy`, a barra, e o glow; `destrutivo` suprime **só** o glow; `rotuloProcessando` alimenta o `aria-label` da barra e tem default `"Processando"`.

**Por que a barra é `sticky top-0`:** alguns modais rolam (`max-h-[90vh] overflow-y-auto`, caso de `dialog-cadastro-produto` e `dialog-adicionar-variacao`) e outros não. Com `sticky`, a barra gruda no topo da área visível no primeiro caso e se comporta como estática no segundo — mesmo código, sem prop de layout. As margens negativas (`-mx-4 -mt-4`) cancelam o `p-4` do content para a barra encostar nas bordas. A barra tem 6px e o botão de fechar começa em 8px (`top-2`): não colidem.

- [ ] **Step 1: Escrever o teste que falha**

Create: `src/components/ui/__tests__/dialog-processando.test.tsx`

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '@/components/ui/alert-dialog';

// O padrão de "está processando": aura colorida no container, barra indeterminada e aria-busy.
// Ação destrutiva perde a aura de propósito — brilho que cicla três cores lê como comemoração,
// e o contrato de motion (§10) proíbe motion lúdico em exclusão.
describe('DialogContent — sinal de processamento', () => {
  const conteudo = () => document.querySelector('[data-slot="dialog-content"]')!;

  it('ocioso não tem aura, nem barra, e aria-busy é false', () => {
    render(
      <Dialog open>
        <DialogContent><DialogTitle>Teste</DialogTitle></DialogContent>
      </Dialog>,
    );
    expect(conteudo()).not.toHaveClass('glow-effect-sombra');
    expect(conteudo()).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('processando liga aura, barra e aria-busy', () => {
    render(
      <Dialog open>
        <DialogContent processando rotuloProcessando="Salvando produto">
          <DialogTitle>Teste</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(conteudo()).toHaveClass('glow-effect-sombra');
    expect(conteudo()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Salvando produto');
  });

  it('destrutivo suprime a aura mas mantém a barra', () => {
    render(
      <Dialog open>
        <DialogContent processando destrutivo rotuloProcessando="Excluindo produto">
          <DialogTitle>Teste</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(conteudo()).not.toHaveClass('glow-effect-sombra');
    expect(conteudo()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('a barra sem rótulo explícito ainda tem nome acessível', () => {
    render(
      <Dialog open>
        <DialogContent processando><DialogTitle>Teste</DialogTitle></DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Processando');
  });
});

describe('AlertDialogContent — sinal de processamento', () => {
  const conteudo = () => document.querySelector('[data-slot="alert-dialog-content"]')!;

  it('processando liga aura, barra e aria-busy', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent processando rotuloProcessando="Pausando anúncio">
          <AlertDialogTitle>Teste</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(conteudo()).toHaveClass('glow-effect-sombra');
    expect(conteudo()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Pausando anúncio');
  });

  it('destrutivo suprime a aura mas mantém a barra', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent processando destrutivo rotuloProcessando="Removendo anúncio">
          <AlertDialogTitle>Teste</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(conteudo()).not.toHaveClass('glow-effect-sombra');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm test src/components/ui/__tests__/dialog-processando.test.tsx`
Expected: FAIL — `processando` não existe como prop, `aria-busy` ausente, nenhum `progressbar`.

- [ ] **Step 3: Implementar no `dialog.tsx`**

Substituir a função `DialogContent` inteira por:

```tsx
function DialogContent({
  className,
  children,
  showCloseButton = true,
  processando = false,
  destrutivo = false,
  rotuloProcessando = "Processando",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Liga o sinal de "está rodando": aura, barra indeterminada e aria-busy. */
  processando?: boolean
  /** Ação destrutiva: mantém a barra, suprime a aura (contrato de motion §10). */
  destrutivo?: boolean
  /** O que está acontecendo, para quem usa leitor de tela: "Salvando produto". */
  rotuloProcessando?: string
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-busy={processando}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-(--motion-duration-instant) outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          processando && !destrutivo && "glow-effect-sombra",
          className
        )}
        {...props}
      >
        {processando && (
          <ProgressoIndeterminado
            label={rotuloProcessando}
            className="sticky top-0 z-10 -mx-4 -mt-4 w-auto rounded-t-xl rounded-b-none"
          />
        )}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}
```

Acrescentar no topo do arquivo, junto aos outros imports:

```tsx
import { ProgressoIndeterminado } from "@/components/ui/progresso-indeterminado"
// A classe `glow-effect-sombra` mora no CSS do GlowEffect, que sem este import só chegaria ao
// bundle pelo componente (sidebar/overlay de login). Importando aqui, todo diálogo do sistema
// ganha a aura sem que cada tela precise lembrar de importar o CSS.
import "@/components/ui/glow-effect.css"
```

- [ ] **Step 4: Implementar no `alert-dialog.tsx`**

Substituir a função `AlertDialogContent` inteira por:

```tsx
function AlertDialogContent({
  className,
  children,
  size = "default",
  processando = false,
  destrutivo = false,
  rotuloProcessando = "Processando",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm"
  /** Liga o sinal de "está rodando": aura, barra indeterminada e aria-busy. */
  processando?: boolean
  /** Ação destrutiva: mantém a barra, suprime a aura (contrato de motion §10). */
  destrutivo?: boolean
  /** O que está acontecendo, para quem usa leitor de tela: "Pausando anúncio". */
  rotuloProcessando?: string
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        aria-busy={processando}
        className={cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-(--motion-duration-instant) outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          processando && !destrutivo && "glow-effect-sombra",
          className
        )}
        {...props}
      >
        {processando && (
          <ProgressoIndeterminado
            label={rotuloProcessando}
            className="sticky top-0 z-10 -mx-4 -mt-4 w-auto rounded-t-xl rounded-b-none"
          />
        )}
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  )
}
```

Nota: `AlertDialogContent` hoje repassa `{...props}` sem desestruturar `children`. Ao passar a renderizar a barra antes do conteúdo, `children` precisa ser desestruturado explicitamente (como acima), senão ele chegaria duas vezes.

Acrescentar o import do `ProgressoIndeterminado` no topo. **Não** repetir o import do `glow-effect.css` — `dialog.tsx` já o carrega e o bundler resolve uma vez só.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm test src/components/ui/__tests__/dialog-processando.test.tsx`
Expected: PASS, 6 testes.

- [ ] **Step 6: Rodar a suíte inteira para pegar regressão**

Run: `pnpm test`
Expected: nenhuma falha nova. Se algo falhar, confirmar se já falhava em `origin/main` **rodando lá**, não inferindo do diff.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/dialog.tsx src/components/ui/alert-dialog.tsx src/components/ui/__tests__/dialog-processando.test.tsx
git commit -m "feat(ui): prop processando nos diálogos, com exceção para ação destrutiva"
```

---

## Task 3: Migrar os dois modais que já usam a aura

**Files:**
- Modify: `src/components/estoque/dialog-adicionar-variacao.tsx:30` (import do CSS), `:277-280` (DialogContent)
- Modify: `src/components/kit/dialog-criar-kit.tsx:24-26` (import do CSS + comentário), `:252-258` (DialogContent)
- Test: `src/components/kit/__tests__/dialog-criar-kit.test.tsx:322-353` (a suíte existente deve continuar passando sem alteração)

**Interfaces:**
- Consumes: props da Task 2.

**Por que primeiro:** estes dois já têm teste cobrindo a aura. Migrá-los antes dos outros prova que a prop reproduz o comportamento atual, com a rede de segurança já escrita.

- [ ] **Step 1: Migrar `dialog-adicionar-variacao.tsx`**

Trocar:

```tsx
      <DialogContent
        aria-busy={salvando}
        className={cn('max-h-[90vh] sm:max-w-3xl overflow-y-auto', salvando && 'glow-effect-sombra')}
      >
```

por:

```tsx
      <DialogContent
        processando={salvando}
        rotuloProcessando="Enviando variações ao Mercado Livre"
        className="max-h-[90vh] sm:max-w-3xl overflow-y-auto"
      >
```

Remover o import `import '@/components/ui/glow-effect.css';` (linha 30) — agora vem do `dialog.tsx`. Se `cn` deixar de ser usado no arquivo, remover o import dele também; se ainda for usado em outro ponto, manter.

- [ ] **Step 2: Migrar `dialog-criar-kit.tsx`**

Trocar o `DialogContent` (linhas 252-258) para usar `processando={mutation.isPending}` e `rotuloProcessando="Criando e publicando o kit"`, removendo `aria-busy` e a entrada `mutation.isPending && 'glow-effect-sombra'` do `cn`. Remover o import do CSS (linhas 24-26, junto com o comentário que explicava a armadilha — ela deixou de existir).

- [ ] **Step 3: Rodar os testes dos dois arquivos**

Run: `pnpm test src/components/kit/__tests__/dialog-criar-kit.test.tsx src/components/estoque/__tests__`
Expected: PASS sem nenhuma alteração nos testes. Se `toHaveClass('glow-effect-sombra')` falhar, a prop não está reproduzindo o comportamento — corrigir a Task 2, não o teste.

- [ ] **Step 4: Commit**

```bash
git add src/components/estoque/dialog-adicionar-variacao.tsx src/components/kit/dialog-criar-kit.tsx
git commit -m "refactor(ui): migra os dois diálogos com aura para a prop processando"
```

---

## Task 4: Grupo A — os 18 modais

**Files:** cada linha da tabela abaixo.

**Interfaces:**
- Consumes: props da Task 2.

**Transformação, em todos:** adicionar `processando={<estado>}` e `rotuloProcessando="<texto>"` ao `DialogContent`/`AlertDialogContent`. Nada mais muda — o botão continua desabilitado e com o texto que já tem.

Exemplo concreto, em `dialog-ajuste.tsx:93`:

```tsx
// antes
<DialogContent>

// depois
<DialogContent processando={mutation.isPending} rotuloProcessando="Ajustando estoque">
```

| Arquivo:linha | Estado a passar | `rotuloProcessando` | `destrutivo` |
|---|---|---|---|
| `estoque/dialog-cadastro-produto.tsx:405` | `ocupado` (já existe, l.395) | `"Cadastrando produto e enviando fotos"` | não |
| `kit-virtual/DialogCriarKitVirtual.tsx:292` | `criarMutation.isPending` | `"Publicando kit virtual"` | não |
| `estoque/dialog-entrada.tsx:186` | `mutation.isPending` | `"Registrando entrada"` | não |
| `estoque/dialog-ajuste.tsx:93` | `mutation.isPending` | `"Ajustando estoque"` | não |
| `estoque/dialog-fiscal-produto.tsx:163` | `!!salvando` | `"Salvando dados fiscais"` | não |
| `estoque/dialog-excluir-produto.tsx:47` | `mutation.isPending` | `"Excluindo produto"` | **sim** |
| `export/botao-exportar.tsx:125` | `gerando` | `"Gerando arquivo"` | não |
| `platform-admin/org-billing.tsx:260` | `close.isPending` | `"Fechando demonstrativo"` | não |
| `platform-admin/revenue-reconciliation.tsx:72` | `reconcile.isPending` | `"Salvando conciliação"` | não |
| `platform-admin/support-request-dialog.tsx:44` | `saving` | `"Enviando solicitação"` | não |
| `pulse/dialog-adicionar.tsx:38` | `mutation.isPending` | `"Buscando produto no Mercado Livre"` | não |
| `pulse/dialog-reprecificar.tsx:102` | `confirmar.isPending` | `"Gravando novos preços"` | não |
| `pages/Revisao.tsx:611` | `setAtacadoLote.isPending` | `"Aplicando atacado ao lote"` | não |
| `pages/Organizacoes.tsx:708` | `enviando` | `"Criando empresa"` | não |
| `pages/Usuarios.tsx:249` | `enviando` | `"Enviando convite"` | não |
| `pages/Usuarios.tsx:322` | `salvando` | `"Salvando notificações"` | não |
| `pages/Usuarios.tsx:404` | `salvando` | `"Salvando menus"` | não |
| `pages/SupportRequests.tsx:166` | `saving` | `"Processando solicitação"` | não |

**Atenção em quatro casos:**

1. `dialog-fiscal-produto.tsx` — `salvando` é `'salvar' | 'proximo' | null`, não booleano. Passar `!!salvando`, senão o TypeScript recusa.
2. `dialog-cadastro-produto.tsx` — usar `ocupado` (linha 395), que já consolida `salvando`, `enviandoFoto` e `enviandoFotos`. Não criar estado novo.
3. `Usuarios.tsx:322` — o modal tem dois botões. A prop reflete **só** o "Salvar" (`salvando`); o "Enviar teste" (`teste.isPending`) é instantâneo e continua como está.
4. `SupportRequests.tsx:166` — é um `AlertDialogContent`, não `DialogContent`, e o título é dinâmico (Aprovar/Rejeitar/Revogar). A prop é a mesma; só o componente muda. É o de espera mais longa do grupo: além da RPC, o handler aguarda `loadRequests()`, que dispara três queries antes de o modal fechar.

- [ ] **Step 1: Aplicar nos 18 pontos da tabela**

Um `DialogContent` por vez, conferindo que o nome do estado confere com o que existe no arquivo (os números de linha são do levantamento de 2026-09-17 e podem ter deslocado).

- [ ] **Step 2: Conferir o `Revisao.tsx:637`**

O modal "Publicar no Mercado Livre" já tem a barra inline (linha ~791) com o texto "Enfileirando famílias e enviando fotos ao Mercado Livre…". **Trocar** aquele `<div className="track-indeterminate" …>` pela prop `processando={publicando}` no `DialogContent`, **mantendo o parágrafo de texto** — o texto explica o que está acontecendo e não é redundante com a barra. Este é o único ponto do Grupo A onde código é removido, não só acrescentado.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: sem erro novo. O erro mais provável aqui é o `!!salvando` esquecido no fiscal.

- [ ] **Step 4: Suíte inteira**

Run: `pnpm test`
Expected: sem falha nova.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): sinal de processamento nos 17 diálogos do grupo A"
```

---

## Task 5: Grupo B — handlers de Publicados viram `async`

**Files:**
- Modify: `src/pages/Publicados.tsx` — os 6 handlers (`handlePausarReativar` l.937 e os equivalentes de migrar, republicar, remover, remover incompleta e refazer kit) e os 6 tipos de prop do card (bloco de tipos que começa em l.205)

**Interfaces:**
- Produces: os 6 handlers passam de `(…) => void` para `(…) => Promise<void>`. Os tipos das props do card mudam junto. A Task 6 depende desta assinatura.

**Por que separar de Task 6:** esta tarefa não muda nada visível — é a preparação que torna o fechamento do modal determinístico. Um revisor pode aprová-la sozinha.

**Padrão da transformação.** Os handlers hoje usam `mutate` com callbacks. Passam a usar `mutateAsync` com `try/catch/finally`, preservando **exatamente** os mesmos toasts e o mesmo `setXId(null)`:

```tsx
// antes
const handlePausarReativar = (mlItemId: string, novoStatus: 'ativo' | 'pausado') => {
  setPausandoId(mlItemId);
  pausarReativar({ mlItemId, status: novoStatus }, {
    onSuccess: () => toast.success(novoStatus === 'pausado' ? 'Anúncio pausado' : 'Anúncio reativado'),
    onError: (err) =>
      toast.error(novoStatus === 'pausado' ? 'Falha ao pausar' : 'Falha ao reativar', {
        description: err instanceof Error ? err.message : String(err),
      }),
    onSettled: () => setPausandoId(null),
  });
};

// depois
const handlePausarReativar = async (mlItemId: string, novoStatus: 'ativo' | 'pausado') => {
  setPausandoId(mlItemId);
  try {
    await pausarReativarAsync({ mlItemId, status: novoStatus });
    toast.success(novoStatus === 'pausado' ? 'Anúncio pausado' : 'Anúncio reativado');
  } catch (err) {
    toast.error(novoStatus === 'pausado' ? 'Falha ao pausar' : 'Falha ao reativar', {
      description: err instanceof Error ? err.message : String(err),
    });
  } finally {
    setPausandoId(null);
  }
};
```

O `mutateAsync` sai do mesmo hook: `const { mutateAsync: pausarReativarAsync, isPending: … } = usePausarReativarPublicado();` — trocar a desestruturação na linha 835 e nas linhas equivalentes dos outros cinco hooks.

**Invariante que o revisor deve checar:** o handler **nunca rejeita**. O `catch` engole o erro depois de mostrar o toast. É isso que garante, na Task 6, que o modal fecha tanto no sucesso quanto na falha — sem essa propriedade, uma falha deixaria o modal preso aberto.

- [ ] **Step 1: Converter os 6 handlers**

Um por vez, preservando toast de sucesso, toast de erro (com `description`) e o `setXId(null)` movido para o `finally`.

- [ ] **Step 2: Atualizar os 6 tipos de prop do card**

No bloco de tipos que começa em `src/pages/Publicados.tsx:205`, trocar o retorno de `void` para `Promise<void>` nas 6 props: `onPausarReativar`, `onRemover`, `onRepublicar`, `onMigrarPrecoPorVariacao`, `onRefazer` e a de remover publicação incompleta.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: sem erro novo. Se aparecer "Promise returned is not awaited" em algum `onClick`, é o ponto que a Task 6 vai converter — anotar e seguir.

- [ ] **Step 4: Rodar os testes de Publicados**

Run: `pnpm test Publicados`
Expected: sem falha nova. Os testes existentes esperam os mesmos toasts, que foram preservados.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Publicados.tsx
git commit -m "refactor(publicados): handlers assíncronos para o modal poder esperar a resposta"
```

---

## Task 6: Grupo B — os 6 modais de Publicados seguram abertos

**Files:**
- Modify: `src/pages/Publicados.tsx` — os 6 `AlertDialog` nas linhas ~400, ~449, ~496, ~527, ~661, ~753
- Test: `src/pages/__tests__/publicados-espera.test.tsx` (criar)

**Interfaces:**
- Consumes: handlers `Promise<void>` da Task 5; props `processando`/`destrutivo` da Task 2.

**Comportamento novo:** o modal fica aberto durante a operação, mostrando o sinal, e fecha sozinho quando termina — no sucesso e no erro. Hoje ele fecha no clique e o operador volta para a tabela sem saber o que está acontecendo.

**Transformação.** Cada `AlertDialog` hoje é não controlado: o `AlertDialogAction` do Radix fecha no clique. Passa a ser controlado, com `preventDefault` no clique:

```tsx
// antes
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button … disabled={!isAdmin || !podeAlternar || pausando || migracaoAtiva}>
      <Pause className="h-3 w-3" />
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Pausar anúncio?</AlertDialogTitle>
      <AlertDialogDescription>…</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction onClick={() => onPausarReativar(item.mlItemId, 'pausado')}>
        Pausar
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

// depois
<AlertDialog open={pausarAberto} onOpenChange={(o) => { if (!pausando) setPausarAberto(o); }}>
  <AlertDialogTrigger asChild>
    <Button … disabled={!isAdmin || !podeAlternar || pausando || migracaoAtiva}>
      <Pause className="h-3 w-3" />
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent processando={pausando} rotuloProcessando="Pausando anúncio">
    <AlertDialogHeader>
      <AlertDialogTitle>Pausar anúncio?</AlertDialogTitle>
      <AlertDialogDescription>…</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel disabled={pausando}>Cancelar</AlertDialogCancel>
      {/* preventDefault impede o Radix de fechar no clique: o modal precisa continuar de pé
          mostrando o sinal até a resposta do Mercado Livre chegar. O handler nunca rejeita
          (Task 5), então este await sempre resolve e o modal nunca fica preso. */}
      <AlertDialogAction
        disabled={pausando}
        onClick={async (e) => {
          e.preventDefault();
          await onPausarReativar(item.mlItemId, 'pausado');
          setPausarAberto(false);
        }}
      >
        Pausar
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

O estado vive no componente do card (o mesmo que já recebe `pausando` por prop), declarado junto aos outros `useState` dele.

| Modal | Estado novo | Estado de pendência já existente | `rotuloProcessando` | `destrutivo` |
|---|---|---|---|---|
| Migrar para preço por variação (~l.400) | `migrarAberto` | `migrando` | `"Migrando anúncio"` | não |
| Pausar anúncio (~l.449) | `pausarAberto` | `pausando` | `"Pausando anúncio"` | não |
| Corrigir e republicar (~l.496) | `republicarAberto` | `republicando` | `"Republicando anúncio"` | não |
| Remover do sistema (~l.527) | `removerAberto` | `removendo` | `"Removendo anúncio"` | **sim** |
| Remover publicação incompleta (~l.661) | `removerIncompletaAberto` | `removendo` | `"Removendo publicação"` | **sim** |
| Refazer kit (~l.753) | `refazerAberto` | `refazendoKit` | `"Refazendo kit"` | não |

- [ ] **Step 1: Escrever os testes que falham**

Create: `src/pages/__tests__/publicados-espera.test.tsx`

Três testes, usando o modal "Pausar" como caso representativo do mecanismo (os outros cinco são a mesma transformação e são cobertos por typecheck + validação visual):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// O modal de confirmação fecha no clique hoje — o operador volta para a tabela sem saber se a
// ação foi. Passa a segurar aberto mostrando o sinal, e fecha sozinho quando o ML responde.
// Fecha também quando falha: modal preso aberto é pior que fechar cedo.
describe('Publicados — confirmação segura aberta durante a operação', () => {
  it('o modal continua aberto e mostra a barra enquanto a pausa está em voo', async () => {
    let concluir!: () => void;
    const onPausarReativar = vi.fn(() => new Promise<void>((res) => { concluir = () => res(); }));

    // renderCard: helper local que monta o card de Publicados com as props mínimas.
    // Ver src/pages/__tests__/ para o padrão de montagem já usado nos testes desta tela.
    const { rerender } = renderCard({ onPausarReativar, pausando: false });

    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await userEvent.click(screen.getByRole('button', { name: /^Pausar$/ }));

    rerender(cardCom({ onPausarReativar, pausando: true }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Pausando anúncio');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();

    concluir();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('falha também fecha o modal — nunca fica preso', async () => {
    // O handler engole o erro e mostra toast (Task 5), então a promise resolve mesmo na falha.
    const onPausarReativar = vi.fn(() => Promise.resolve());
    renderCard({ onPausarReativar, pausando: false });

    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await userEvent.click(screen.getByRole('button', { name: /^Pausar$/ }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('a ação é disparada uma única vez, mesmo com clique duplo', async () => {
    const onPausarReativar = vi.fn(() => new Promise<void>(() => {}));
    renderCard({ onPausarReativar, pausando: false });

    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    const confirmar = screen.getByRole('button', { name: /^Pausar$/ });
    await userEvent.click(confirmar);
    await userEvent.click(confirmar);

    expect(onPausarReativar).toHaveBeenCalledTimes(1);
  });
});
```

O helper `renderCard`/`cardCom` deve seguir o padrão de montagem já usado nos testes existentes desta tela — ler `src/pages/__tests__/` antes de escrever, e reaproveitar o que houver em vez de inventar um novo.

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm test publicados-espera`
Expected: FAIL — o modal fecha no clique, não há `progressbar`.

- [ ] **Step 3: Aplicar a transformação nos 6 modais**

Um por vez, seguindo a tabela. Cada um: estado novo, `open`/`onOpenChange` guardado pelo estado de pendência, `processando` (+ `destrutivo` nos dois de remover), `AlertDialogCancel` desabilitado, `onClick` com `preventDefault` + `await` + fechar.

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test publicados-espera`
Expected: PASS, 3 testes.

- [ ] **Step 5: Suíte inteira**

Run: `pnpm test`
Expected: sem falha nova. Testes antigos que clicavam em confirmar e esperavam o modal sumir na hora podem precisar de `waitFor` — ajustar o **teste**, porque o comportamento mudou de propósito, e registrar o ajuste no commit.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Publicados.tsx src/pages/__tests__/publicados-espera.test.tsx
git commit -m "feat(publicados): confirmação segura aberta até o Mercado Livre responder"
```

---

## Task 7: Grupo B — o modal de saque em DetalheFinanceiro

**Files:**
- Modify: `src/pages/DetalheFinanceiro.tsx:585-591` (handler) e `:680` (AlertDialog)

**Interfaces:**
- Consumes: props da Task 2.

O handler hoje chama `mutation.mutate(...)` e `setConfirmarSaque(null)` na mesma função — o modal fecha antes da resposta. O `open` já é controlado (`confirmarSaque`), então aqui não é preciso criar estado: basta parar de fechar no clique e passar a fechar depois do `await`.

- [ ] **Step 1: Tornar o handler assíncrono**

Converter para `mutateAsync` com `try/catch/finally`, preservando os toasts existentes, e **remover** o `setConfirmarSaque(null)` de dentro dele.

- [ ] **Step 2: Fechar depois do await, no `onClick` do Action**

```tsx
<AlertDialogAction
  disabled={processandoSaque}
  onClick={async (e) => {
    e.preventDefault();
    await confirmarSaqueAgora();
    setConfirmarSaque(null);
  }}
>
```

Onde `processandoSaque` é `mutationRegistrar.isPending || mutationDesfazer.isPending` (os dois já existem no arquivo).

- [ ] **Step 3: Aplicar o sinal e travar o cancelar**

`<AlertDialogContent processando={processandoSaque} rotuloProcessando="Registrando saque">`, `AlertDialogCancel` com `disabled={processandoSaque}`, e `onOpenChange` guardado para não fechar em voo.

- [ ] **Step 4: Typecheck e testes**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm test DetalheFinanceiro`
Expected: sem falha nova.

- [ ] **Step 5: Commit**

```bash
git add src/pages/DetalheFinanceiro.tsx
git commit -m "feat(financeiro): confirmação de saque espera a resposta antes de fechar"
```

---

## Task 8: Grupo C — pendência nas confirmações de remover foto

**Files:**
- Modify: `src/components/familia-expanded.tsx:419+` (handlers `lidarRemoverCapa*`), `:671`, `:716`, `:755` (os 3 AlertDialog)
- Test: `src/components/__tests__/familia-expanded-remover-foto.test.tsx` (criar)

**Interfaces:**
- Consumes: props da Task 2.

Estes 3 modais chamam um handler `async` sem rastrear pendência e sem desabilitar o botão: **hoje é possível clicar duas vezes e disparar duas remoções**. Esta tarefa corrige isso e aplica o sinal como consequência.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Sem estado de pendência, o botão continuava clicável durante a remoção e disparava duas vezes.
describe('FamiliaExpanded — remover capa', () => {
  it('clique duplo remove uma única vez e o modal mostra o progresso', async () => {
    const remover = vi.fn(() => new Promise<void>(() => {}));
    renderFamiliaExpanded({ onRemoverCapa: remover });

    await userEvent.click(screen.getByRole('button', { name: /remover capa/i }));
    const confirmar = screen.getByRole('button', { name: /^Remover$/ });
    await userEvent.click(confirmar);
    await userEvent.click(confirmar);

    expect(remover).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
  });
});
```

Adaptar o helper de montagem ao que já existir nos testes deste componente.

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test familia-expanded-remover-foto`
Expected: FAIL — `remover` chamado 2 vezes.

- [ ] **Step 3: Criar o estado de pendência**

Um estado por slot, no componente: `const [removendoFoto, setRemovendoFoto] = useState<'capa' | 'capa2' | 'capa3' | null>(null);`

Cada handler `lidarRemoverCapa*` passa a: setar o slot no começo, `try/finally` com `setRemovendoFoto(null)` no fim.

- [ ] **Step 4: Controlar os 3 modais**

Mesma transformação da Task 6: `open` controlado, `preventDefault` no Action, `processando={removendoFoto === 'capa'}` **com `destrutivo`** (é remoção), `Cancel` desabilitado, fechar depois do `await`.

- [ ] **Step 5: Rodar os testes**

Run: `pnpm test familia-expanded`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/familia-expanded.tsx src/components/__tests__/familia-expanded-remover-foto.test.tsx
git commit -m "fix(familia): remoção de foto rastreia pendência e não dispara duas vezes"
```

---

## Task 9: Grupo D — barra em 7 botões fora de modal

**Files:** cada linha da tabela.

**Interfaces:**
- Consumes: `ProgressoIndeterminado` da Task 1.

**Transformação:** a barra entra logo abaixo do botão (ou da barra de ações que o contém), só enquanto a operação roda. Sem glow — é efeito de container, e num botão de toolbar fica deslocado.

```tsx
{atualizando && <ProgressoIndeterminado label="Atualizando anúncios" className="mt-1" />}
```

| Arquivo:linha | Condição | `label` |
|---|---|---|
| `pages/Revisao.tsx:373` | `reprocessarLote.isPending` | `"Reenviando famílias com erro"` |
| `pages/Publicados.tsx:1178` | `fetchingStatus \|\| fetchingMetricas` | `"Atualizando anúncios"` |
| `pages/DetalheFinanceiro.tsx:522` | `isFetching` | `"Atualizando vendas"` |
| `pages/DetalheFinanceiro.tsx:585/589` | `processandoSaque` (Task 7) | `"Processando saque"` |
| `pages/Organizacoes.tsx:458` | `cancellingRequestId === req.id` | `"Cancelando solicitação"` |
| `components/familia-expanded.tsx:824` | `regenerar.isPending` | `"Gerando descrição com IA"` |
| `components/kit/dialog-criar-kit.tsx:345` | `reenviarMutation.isPending` | `"Reenviando fotos"` |

**`Organizacoes.tsx:322/455` ("Entrar na operação") fica de fora desta tarefa.** Não tem estado de pendência nenhum e a função navega para outra tela ao terminar — criar o estado ali é trabalho de comportamento, não de sinalização, e o ganho é duvidoso já que a tela troca. Registrar como pendência conhecida no relatório final.

**`variacao-card.tsx:73` também fica de fora:** já tem tratamento próprio (`StatusInline`) que informa mais do que uma barra genérica. Trocar seria piorar.

- [ ] **Step 1: Aplicar nos 7 pontos**

- [ ] **Step 2: Typecheck e suíte**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm test`
Expected: sem falha nova.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): barra de progresso nos botões de espera fora de modal"
```

---

## Task 10: Emenda ao contrato de motion e ADR

**Files:**
- Modify: `docs/motion/contrato-motion-v5.md` §9 e §10
- Create: `docs/decisions/0XXX-padrao-de-espera-em-dialogos.md` — **número escolhido depois de `git fetch`**, porque há ADRs sendo criados em paralelo. Quem já está na `main` não renumera.
- Modify: `docs/decisions/README.md` (ou o índice equivalente) e `obsidian-vault/04-Decisões/Índice de ADRs.md`

- [ ] **Step 1: `git fetch` e escolher o número do ADR**

```bash
git fetch origin
ls docs/decisions/ | tail -5
```

- [ ] **Step 2: Escrever o ADR**

Conteúdo mínimo: o padrão (glow + barra; barra sozinha em destrutiva e fora de modal), a decisão do Grupo B (modal segura aberto até a resposta) com o motivo, a consequência para o operador (a confirmação deixa de fechar na hora nessas 7 telas), e a alternativa descartada (indicar na linha da tabela, que manteria 7 telas com padrão próprio).

- [ ] **Step 3: Emendar o contrato de motion**

No §9, deixar explícito que "nunca um padrão universal de carregamento" continua valendo para **carregamento de conteúdo** (skeleton por fluxo, etapas reais quando existirem), e que o padrão desta entrega cobre **ação disparada pelo operador**, que é outra coisa. Sem essa distinção a emenda contradiz o próprio §9.

No §10, registrar a exceção destrutiva como regra: ação destrutiva recebe a barra, nunca o glow.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(motion): registra o padrão de espera e a decisão do grupo B"
```

---

## Task 11: Validação visual e fecho

**Files:** nenhum de produção.

- [ ] **Step 1: Preflight**

Run: `pnpm preflight:static`
Expected: verde. Este é o portão real — build local não reproduz o CI.

- [ ] **Step 2: Subir a app no worktree**

Copiar `.env.local` (gitignored) do checkout principal antes de subir, senão a app abre branca.

- [ ] **Step 3: Validação visual com Playwright**

Usar a skill `playwright-cli`. Sessão isolada, **nunca** disputar o Chrome do Diego via CDP. Screenshot real em cada alvo — snapshot de acessibilidade não pega bug de layout CSS.

Alvos mínimos:
1. **Modal que rola** (cadastro de produto): a barra gruda no topo ao rolar? O `sticky` é a parte mais frágil do desenho.
2. **Modal destrutivo** (excluir produto): barra presente, aura **ausente**.
3. **Modal do Grupo B** (pausar anúncio): segura aberto durante a operação e fecha sozinho.
4. **Tema claro e escuro**: a aura usa `--chart-1/2/3` e a barra usa `--primary`; conferir que os dois aparecem nos dois temas.

- [ ] **Step 4: Revisão do Fable sobre o diff completo**

Obrigatória antes do merge. Atenção especial ao Grupo B (Tasks 5, 6 e 7), que muda comportamento em telas de produção do Mercado Livre.

- [ ] **Step 5: Merge**

Só com CI verde (`frontend`, `backend-lint`) e OK do Fable. Fast-forward na `main`. Depois: deletar a branch, remover a worktree e **`git pull` na main local**.

Nenhum arquivo em `supabase/functions/**` ou `supabase/migrations/**` foi tocado — esta entrega é só frontend, então não há deploy de Edge Function nem `db push`. Confirmar isso com `git diff --stat origin/main` antes de fechar.

---

## Pendências conhecidas (não entram nesta entrega)

- `Organizacoes.tsx:322/455` ("Entrar na operação") segue sem estado de pendência — ver Task 9.
- `variacao-card.tsx` mantém `StatusInline` na troca de foto, de propósito.
- Os 5 modais restantes do Grupo B (fora o "Pausar") não têm teste dedicado: são a mesma transformação, cobertos por typecheck e pela validação visual. Se a revisão do Fable considerar insuficiente para ações de ML, escrever os 5.
