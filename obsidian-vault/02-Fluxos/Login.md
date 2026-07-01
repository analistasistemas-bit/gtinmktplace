---
tags: [fluxos, auth]
atualizado: 2026-07-01
---

# Login

Ver [[Segurança]], [[Usuários]].

## Fluxo

```mermaid
sequenceDiagram
    participant U as Operador
    participant FE as Frontend (Login.tsx)
    participant SB as Supabase Auth
    participant Store as auth-store (Zustand)

    U->>FE: email + senha
    FE->>SB: signInWithPassword()
    SB-->>FE: session
    FE->>Store: hydrate() / onAuthStateChange
    Store->>SB: SELECT profiles (is_admin, allowed_menus)
    Store-->>FE: profile carregado
    FE->>U: redireciona (ProtectedRoute + MenuGuard)
```

## Páginas (`src/pages/`)

- **Login.tsx** — formulário e-mail/senha, chama `signIn()` (`src/lib/auth.ts`)
- **DefinirSenha.tsx** — primeira definição de senha (link do convite)
- **ResetSenha.tsx** — solicitação de reset (`sendPasswordReset()`, redireciona para
  `/#/definir-senha`)
- **SemAcesso.tsx** — exibido quando o usuário está autenticado mas sem permissão de menu

## Código

- `src/lib/auth.ts` — `signIn()`, `signOut()`, `sendPasswordReset()` (fininas sobre
  `supabase.auth.*`)
- `src/stores/auth-store.ts` (Zustand) — `hydrate()`, `setSession()`, `loadProfile()`; escuta
  `supabase.auth.onAuthStateChange`
- `src/components/protected-route.tsx` — redireciona para `/login` se não autenticado
- `src/components/menu-guard.tsx` — redireciona para `/sem-acesso` se a rota não está em
  `profile.allowed_menus` (exceto admin, que vê tudo)

## Convite de usuário

Não é auto-cadastro — usuários são convidados pelo admin (edge `usuarios`,
`auth.admin.inviteUserByEmail`). E-mail transacional via SMTP próprio (Resend), não o serviço
interno do Supabase. Ver [[Usuários]].
