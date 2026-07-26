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
pnpm build
pnpm lint:functions
pnpm check:functions
supabase db reset
```

Não prossiga se houver erro novo. Os avisos já conhecidos devem ser registrados, sem serem
tratados como falha desta implantação.

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

## 3. Aplicar o schema

Use somente o canal canônico de migrations:

```bash
supabase db push --linked
supabase migration list --linked
```

A migration desta entrega é
`supabase/migrations/20260725224000_support_access.sql`.

## 4. Publicar a Edge Function

```bash
supabase functions deploy suporte
supabase functions list
```

Confirme que a versão da função mudou e que `verify_jwt` continua conforme
`supabase/config.toml`.

## 5. Ajustar as identidades

Execute as alterações com transação e IDs previamente conferidos. Não use nomes como
identificador.

1. Vincule `analistasistemas@gmail.com` à Avil com `is_admin = true` e
   `is_super_admin = false`.
2. Vincule `analistasistemas@icloud.com` à organização de testes com `is_admin = true` e
   `is_super_admin = false`.
3. Marque a organização permanente como `is_test = true`.
4. Configure `diego@daludi.com.br` com `org_id = null`, `is_admin = false` e
   `is_super_admin = true`.

Após cada alteração, confira e-mail, `org_id`, `is_admin` e `is_super_admin`. A restrição
`profiles_identity_xor` impede que um super-admin também pertença a uma organização.

## 6. Teste de fumaça

1. Entrar como `diego@daludi.com.br`.
2. Na tela **Organizações**, solicitar acesso somente leitura à organização de testes.
3. Entrar como `analistasistemas@icloud.com`, abrir **Solicitações de suporte** e aprovar.
4. Voltar ao super-admin, iniciar a sessão e confirmar o banner, organização e horário final.
5. Confirmar que o modo leitura bloqueia escrita.
6. Encerrar a sessão e repetir com acesso completo.
7. Revogar a segunda sessão pelo administrador da organização.
8. Confirmar que o super-admin perde o acesso imediatamente.
9. Conferir os registros de solicitação e auditoria.
10. Enviar uma solicitação para um endereço controlado e validar o link autenticado do e-mail.

Não use a Avil no primeiro teste de produção.

## 7. Critérios de aceite

- Nenhuma organização pode ser aberta sem pedido aprovado.
- Aprovação vencida não inicia sessão.
- Sessão dura no máximo 2 horas.
- Renovação só pode ser pedida nos 15 minutos finais e exige nova aprovação.
- Somente administradores ativos da organização podem aprovar, rejeitar ou revogar.
- Acesso completo não permite administrar usuários, organização, cobrança ou propriedade.
- Auditoria registra ator, organização, solicitação, ação, resultado e horário.

## Interrupção e reversão

Se o fluxo apresentar comportamento inseguro:

1. Revogue ou encerre as sessões ativas na tela de solicitações.
2. Remova temporariamente `is_super_admin` do usuário da Daludi.
3. Restaure a versão anterior da função `suporte`, se o problema estiver no handler.
4. Não reverta a migration destrutivamente: as tabelas são aditivas e preservam auditoria.
5. Corrija em nova migration ou nova versão da função e repita o teste de fumaça.

Nunca apague o histórico de auditoria durante uma reversão.
