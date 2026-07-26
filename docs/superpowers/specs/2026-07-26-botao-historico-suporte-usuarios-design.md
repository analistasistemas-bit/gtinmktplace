# Botão de histórico de suporte em Usuários

**Data:** 2026-07-26
**Status:** aprovado para implementação

## Objetivo

Permitir que administradores da organização encontrem o Histórico de suporte
diretamente na tela Usuários, sem depender de notificação ou URL manual.

## Interface

O cabeçalho da página Usuários terá duas ações:

- `Histórico de suporte`, com estilo secundário, navegando para `/suporte`;
- `Convidar usuário`, preservado como ação principal.

O componente existente `PageHeader` será reutilizado. Em telas estreitas, suas
ações continuarão quebrando linha pelo comportamento responsivo já existente.

## Autorização

A página Usuários já é protegida pelo menu e pelas permissões administrativas.
O botão não concede acesso adicional: a rota `/suporte` mantém sua própria
validação e somente administradores podem consultar o histórico.

## Teste

Um teste da página Usuários verificará que o botão é renderizado e que seu link
aponta para `/suporte`. O teste deverá falhar antes da inclusão do botão e passar
depois da implementação.

## Fora do escopo

- alterar o menu lateral;
- modificar dados, políticas RLS ou Edge Functions;
- alterar a tela Histórico de suporte.
