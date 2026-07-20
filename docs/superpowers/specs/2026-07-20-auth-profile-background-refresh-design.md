# Atualização silenciosa do perfil de autenticação

## Problema

Ao voltar para a aba do PubliAI, o Supabase pode emitir `TOKEN_REFRESHED`. O
`auth-store` atual trata qualquer evento de autenticação como carregamento
bloqueante: define `profileLoading = true` e recarrega o perfil.
`ProtectedRoute` e `MenuGuard` substituem o `Outlet` por “Carregando…”, desmontando
a página atual. Com isso, filtros e rascunhos mantidos no estado local são perdidos.

## Decisão

Manter o carregamento bloqueante apenas na hidratação inicial e nos eventos em que
uma nova sessão ou um novo usuário precisa ser estabelecido. Em
`TOKEN_REFRESHED`, recarregar o perfil silenciosamente, sem alterar
`profileLoading` para `true`.

O perfil retornado continua substituindo o perfil anterior. Portanto, mudanças de
permissão e desativação de conta continuam sendo aplicadas assim que a consulta
terminar, mas a rota permanece montada durante a atualização.

## Escopo

- Distinguir eventos bloqueantes de `TOKEN_REFRESHED` no `auth-store`.
- Permitir que `loadProfile` escolha entre carregamento bloqueante e silencioso.
- Cobrir a regressão com testes unitários do store.
- Preservar o comportamento atual de login, logout, troca de usuário e conta
  desativada.

Não faz parte do escopo persistir filtros ou rascunhos em URL, storage ou store
global. Também não será alterado o polling de vendas.

## Fluxo

1. Na hidratação inicial, a sessão é obtida e o perfil é carregado de forma
   bloqueante.
2. Em login ou troca real de usuário, o perfil é carregado de forma bloqueante.
3. Em `TOKEN_REFRESHED` para o mesmo usuário, o perfil é carregado silenciosamente.
4. Ao concluir a consulta silenciosa, o perfil atualizado é publicado no store.
5. Se o perfil vier desativado, a proteção de rota existente encerra a sessão.
6. Em logout, sessão, usuário e perfil são limpos como hoje.

## Segurança

A atualização silenciosa não ignora nem congela permissões: ela consulta novamente
`profiles` e publica o resultado. Somente o indicador bloqueante é preservado como
`false`. A consulta continua limitada ao ID do usuário autenticado e nenhuma regra
de autorização ou RLS é alterada.

## Testes e critérios de aceite

- `TOKEN_REFRESHED` mantém `profileLoading = false` durante a consulta.
- O perfil é atualizado quando a consulta silenciosa termina.
- Login/troca de usuário continua usando carregamento bloqueante.
- Logout continua limpando o perfil.
- `ProtectedRoute` e `MenuGuard` não desmontam a rota durante renovação do token.
- O polling/refetch de vendas continua sem alterações.
- Teste unitário direcionado, TypeScript e lint dos arquivos tocados passam.

## Alternativas rejeitadas

- Ignorar `TOKEN_REFRESHED`: preservaria a tela, mas atrasaria mudanças de
  permissão e desativação até o próximo login ou refresh.
- Persistir todos os filtros e rascunhos: protegeria contra refresh real, porém
  espalharia mudanças por vários menus sem corrigir a causa do remount.
