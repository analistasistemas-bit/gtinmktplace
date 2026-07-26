# Botão de histórico de suporte em Usuários — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir na tela Usuários um botão administrativo que navega para o Histórico de suporte.

**Architecture:** Reutilizar o slot `actions` do `PageHeader` e o roteamento interno do React Router. A autorização continua nas proteções existentes das rotas `/usuarios` e `/suporte`; não haverá alteração de backend.

**Tech Stack:** React 18, TypeScript, React Router, Vitest e Testing Library.

## Global Constraints

- O botão deve se chamar `Histórico de suporte`.
- O destino deve ser `/suporte`.
- `Convidar usuário` continua sendo a ação principal.
- Não alterar menu lateral, banco ou Edge Functions.

---

### Task 1: Ação de acesso ao histórico

**Files:**
- Create: `src/pages/__tests__/Usuarios.test.tsx`
- Modify: `src/pages/Usuarios.tsx`

**Interfaces:**
- Consumes: rota já existente `/suporte` e propriedade `actions: ReactNode` de `PageHeader`.
- Produces: link acessível com nome `Histórico de suporte` e `href="/suporte"`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/pages/__tests__/Usuarios.test.tsx` com mocks mínimos das consultas e:

```tsx
it('oferece acesso ao histórico de suporte no cabeçalho', () => {
  render(
    <MemoryRouter>
      <Usuarios />
    </MemoryRouter>,
  );

  expect(screen.getByRole('link', { name: /histórico de suporte/i }))
    .toHaveAttribute('href', '/suporte');
  expect(screen.getByRole('button', { name: /convidar usuário/i }))
    .toBeInTheDocument();
});
```

- [ ] **Step 2: Confirmar a falha**

Executar:

```bash
pnpm test -- src/pages/__tests__/Usuarios.test.tsx
```

Resultado esperado: falha porque o link `Histórico de suporte` ainda não existe.

- [ ] **Step 3: Implementar o botão mínimo**

Em `src/pages/Usuarios.tsx`, importar `Link` e `History`, e substituir a ação única por:

```tsx
actions={
  <>
    <Button asChild variant="outline">
      <Link to="/suporte"><History aria-hidden="true" />Histórico de suporte</Link>
    </Button>
    <Button onClick={() => setInviteOpen(true)}>Convidar usuário</Button>
  </>
}
```

- [ ] **Step 4: Confirmar o teste verde**

Executar:

```bash
pnpm test -- src/pages/__tests__/Usuarios.test.tsx
```

Resultado esperado: teste aprovado.

- [ ] **Step 5: Validar o escopo**

Executar:

```bash
pnpm lint
pnpm test
pnpm build
```

Resultado esperado: comandos aprovados sem regressões novas.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Usuarios.tsx src/pages/__tests__/Usuarios.test.tsx
git commit -m "feat: link support history from users"
```

### Task 2: Validar e publicar

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: build validado da Task 1.
- Produces: botão navegável no ambiente publicado.

- [ ] **Step 1: Validar no navegador local**

Abrir a tela `/usuarios` como administrador e confirmar que:

1. `Histórico de suporte` aparece ao lado de `Convidar usuário`;
2. o clique navega para `/suporte`;
3. o layout continua utilizável em largura móvel.

- [ ] **Step 2: Integrar e enviar**

Fazer merge fast-forward na `main` sem tocar nas alterações locais preexistentes e enviar ao remoto.

- [ ] **Step 3: Confirmar CI e produção**

Esperar o CI da `main` ficar verde e repetir no ambiente publicado as verificações da Step 1.
