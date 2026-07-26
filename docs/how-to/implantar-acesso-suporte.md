# How-to — Implantar o acesso autorizado de suporte

> **Escopo:** publicar o fluxo em que a Daludi solicita acesso temporário a uma organização
> cliente. Este roteiro não autoriza executar a publicação; cada etapa deve ser confirmada no
> ambiente de produção.

## Resultado esperado

- `diego@daludi.com.br` é super-admin da plataforma, sem organização.
- `analistasistemas@gmail.com` continua na Avil, sem super-admin.
- `analistasistemas@icloud.com` administra a organização permanente de testes.
- Todo acesso da Daludi, inclusive somente leitura, depende de aprovação do cliente.
- Solicitações, decisões, sessões e ações ficam auditadas por 1 ano.

## Pré-requisitos

- Branch integrada e checkout limpo na branch de produção.
- Supabase CLI autenticado e projeto de produção corretamente vinculado.
- Backup recente e janela de implantação definida.
- Usuário `diego@daludi.com.br` criado e com e-mail confirmado no Supabase Auth.
- IDs da Avil e da organização de testes conferidos no banco.
- Domínio remetente validado no Resend.

## 1. Validar antes da publicação

```bash
pnpm tsc
pnpm lint
pnpm test
pnpm build
pnpm lint:functions
pnpm check:functions
supabase db reset
npm run db:check
```

Não prossiga se houver erro novo. Os avisos já conhecidos devem ser registrados, sem serem
tratados como falha desta implantação. `npm run db:check` deve passar; **antes do primeiro
`db push`**, admite-se somente a divergência que liste exclusivamente a migration local pendente
`20260726153552_finalize_support_access.sql`, ausente no remoto. Registre essa exceção e pare para
qualquer outra migration divergente; ela não autoriza ignorar diferenças adicionais.

## 2. Configurar os secrets

Os valores reais não devem ser commitados:

```bash
supabase secrets set \
  RESEND_API_KEY='<chave-resend>' \
  SUPPORT_EMAIL_FROM='PublIAI <publiai@daludi.com.br>' \
  APP_URL='<url-oficial-do-publiai>'

supabase secrets list
```

`APP_URL` não deve terminar com `/`; o e-mail acrescenta `/#/admin/suporte`.

## 3. Conferir as identidades antes do `db push`

Execute as alterações em uma transação, usando os IDs previamente conferidos (nunca nomes), e
confirme no banco que nenhuma identidade viola o estado final:

1. Vincule `analistasistemas@gmail.com` à Avil com `is_admin = true` e
   `is_super_admin = false`.
2. Vincule `analistasistemas@icloud.com` à DSA de testes (`slug = 'diego-souza'`, ID previamente
   conferido) com `is_admin = true` e `is_super_admin = false`.
3. Marque a DSA (`diego-souza`, ID previamente conferido) como `is_test = true`.
4. Configure `diego@daludi.com.br` com `org_id = null`, `is_admin = false` e
   `is_super_admin = true`.

Corrija a migração de identidades antes de continuar. A migration final valida
`profiles_identity_xor`; um perfil híbrido faz o `db push` inteiro falhar e reverter.

## 4. Aplicar o schema

Use somente o canal canônico de migrations:

```bash
supabase db push --linked
supabase migration list --linked
```

A entrega inclui `20260725224000_support_access.sql` e a finalização transacional
`20260726153552_finalize_support_access.sql`. Esta última instala a RPC
`start_support_session(uuid, uuid, timestamptz)`, valida o XOR e agenda o cron diário
`cleanup-support-audit-events` às 03:15 para executar
`cleanup_support_audit_events()`.

## 5. Publicar a Edge Function

```bash
supabase functions deploy suporte
supabase functions list
```

Confirme que a versão da função mudou e que `verify_jwt` continua conforme
`supabase/config.toml`.

## 6. Verificar as identidades após a publicação

Sem fazer novas mutações, confira novamente por ID e e-mail que `diego@daludi.com.br` não tem
`org_id` e é o super-admin, que `analistasistemas@gmail.com` é admin da Avil sem super-admin e
que `analistasistemas@icloud.com` é admin da DSA de testes (`diego-souza`, ID previamente
conferido) sem super-admin. A restrição `profiles_identity_xor` impede que um super-admin também
pertença a uma organização.

## 7. Teste de fumaça

1. Entrar como `diego@daludi.com.br`.
2. Na tela **Organizações**, solicitar acesso somente leitura à organização de testes.
3. Entrar como `analistasistemas@icloud.com`, abrir **Solicitações de suporte** e aprovar.
4. Voltar ao super-admin, iniciar a sessão e confirmar o banner, organização e horário final.
5. Confirmar que o modo leitura bloqueia escrita.
6. Encerrar a sessão e repetir com acesso completo.
7. Revogar a segunda sessão pelo administrador da organização.
8. Confirmar que o super-admin perde o acesso imediatamente.
9. Nos 15 minutos finais, solicitar renovação, aprovar e iniciar a nova sessão; confirmar que a
   anterior foi encerrada e que há auditoria `session_ended` e `session_started`.
10. Conferir os registros de solicitação e auditoria.
11. Enviar uma solicitação para um endereço controlado e validar o link autenticado do e-mail.

Não use a Avil no primeiro teste de produção.

## 8. Critérios de aceite

- Nenhuma organização pode ser aberta sem pedido aprovado.
- Aprovação vencida não inicia sessão.
- Sessão dura no máximo 2 horas.
- Renovação só pode ser pedida nos 15 minutos finais e exige nova aprovação.
- Somente administradores ativos da organização podem aprovar, rejeitar ou revogar.
- Acesso completo não permite administrar usuários, organização, cobrança ou propriedade.
- Auditoria registra ator, organização, solicitação, ação, resultado e horário.
- O cron `cleanup-support-audit-events` permanece único e remove apenas registros com mais de
  um ano sem `legal_hold`.

## Interrupção e reversão

Se o fluxo apresentar comportamento inseguro:

1. Revogue ou encerre as sessões ativas na tela de solicitações.
2. Remova temporariamente `is_super_admin` do usuário da Daludi.
3. Restaure a versão anterior da função `suporte`, se o problema estiver no handler.
4. Não reverta a migration destrutivamente: as tabelas são aditivas e preservam auditoria.
5. Corrija em nova migration ou nova versão da função e repita o teste de fumaça.

Nunca apague o histórico de auditoria durante uma reversão.
