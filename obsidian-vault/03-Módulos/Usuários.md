---
tags: [modulo, usuarios]
atualizado: 2026-08-28
---

# Usuários

Rota `/configuracoes/membros`, exclusiva de **admin** (`src/pages/Usuarios.tsx`, montada como a
seção "Membros e acessos" de [[Configurações]] desde 2026-08-28). Ver [[Segurança]] (RBAC),
[[Login]] (fluxo de auth), [[Banco de Dados]] (tabela `profiles`).

Deixou de ser item do menu lateral — gestão de acesso é configuração, e o menu já tinha 12
itens. `/usuarios` continua existindo e redireciona para a seção; `MENU_KEYS`, `visibleMenus` e
a chave de menu `usuarios` ficaram **intactos**, então o RBAC do ADR-0047 não mudou. A
visibilidade da seção é lida de `visibleMenus(profile, !!contextoDeSuporte)`, não derivada de
`is_admin`: numa sessão de suporte o super-admin carrega `is_admin = true`, e derivar da flag
reabriria a seção para quem nunca a viu.

`Canais` **não** foi movido junto: é operação (destino do callback OAuth, reconexão de token) e
cresce com o E5/Shopee (ADR-0077).

## Contexto

Dentro de uma organização, os membros veem/operam os mesmos dados; organizações são isoladas por
`org_id`. Permissões de menu continuam definidas por usuário.

## Ações (edge function `usuarios`, `verify_jwt=true`, admin-only)

| Ação | O que faz |
|---|---|
| `invite` | Convida por e-mail (`auth.admin.inviteUserByEmail`) com `nome`/`allowed_menus` no metadata; redireciona para `/#/definir-senha` |
| `update_menus` | Atualiza `allowed_menus` de um usuário |
| `set_active` | Ativa/desativa um usuário |
| `set_admin` | Promove/remove admin |

## Tabela `profiles`

Espelho 1:1 de `auth.users`. `email`, `nome`, `is_admin`, `is_active`, `allowed_menus text[]`.
Criada no signup pelo trigger `handle_new_user` (semeia do metadata do convite).

## E-mail transacional

Sai do serviço interno do Supabase; usa SMTP próprio via Resend (`publiai@daludi.com.br`).
