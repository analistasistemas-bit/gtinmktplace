# Correções do acesso autorizado de suporte

**Data:** 2026-07-26  
**Status:** aprovado para planejamento  
**Origem:** achados do `code-review-fable5` sobre `c8794db^..fe640d9`

## Objetivo

Corrigir três lacunas do fluxo definido no ADR-0092:

1. permitir que uma renovação aprovada substitua a sessão ativa sem interrupção nem estado parcial;
2. executar automaticamente a retenção anual dos eventos de auditoria;
3. validar definitivamente a restrição que separa identidades Daludi de membros dos tenants.

## Escopo

O trabalho fica restrito ao backend de suporte, migrations, testes SQL e documentação operacional. Não haverá alteração visual, mudança nos prazos já aprovados ou ampliação das permissões de suporte.

## Renovação transacional

Uma nova função PostgreSQL, executada somente pelo backend com `service_role`, receberá o ID da solicitação aprovada, o solicitante autenticado e o instante da operação.

Na mesma transação ela deverá:

1. bloquear a solicitação nova para atualização;
2. confirmar que ela está `approved`, pertence ao solicitante e ainda está dentro de `approval_expires_at`;
3. se `renewal_of` estiver preenchido, bloquear e validar a sessão anterior:
   - mesmo solicitante;
   - mesma organização;
   - estado `active`;
   - ainda vigente;
4. encerrar a sessão anterior com `status = 'ended'` e `ended_at` igual ao início da nova;
5. ativar a nova solicitação com duas horas completas a partir desse instante;
6. registrar `session_ended` para a sessão substituída, quando houver, e `session_started`
   para a nova sessão;
7. devolver a nova linha ativa.

Qualquer falha aborta toda a transação. Assim, a sessão vigente nunca é encerrada sem que a renovação seja ativada. O índice que permite uma única sessão ativa por super-admin será preservado.

Solicitações iniciais, sem `renewal_of`, usarão a mesma função e continuarão exigindo
ausência de outra sessão ativa. A Edge Function continuará responsável por autenticação
e autorização; a RPC receberá o ator já autenticado e gravará os eventos desta transição
na mesma transação para impedir sessão iniciada sem auditoria.

## Retenção automática

Uma migration nova habilitará `pg_cron`, caso necessário, e registrará um job diário, com nome estável, para executar `cleanup_support_audit_events()`.

O agendamento será idempotente: uma nova aplicação da migration não poderá criar jobs duplicados. A função existente continuará removendo somente eventos com mais de um ano e `legal_hold = false`.

## Validação da identidade

Antes de validar `profiles_identity_xor`, a migration verificará se existe algum perfil incompatível:

- super-admin com `org_id` preenchido; ou
- usuário comum sem `org_id`.

Se houver qualquer linha inválida, a migration falhará sem modificar o schema. Com os dados conformes, executará:

```sql
alter table public.profiles
  validate constraint profiles_identity_xor;
```

Isso transforma a migração operacional já concluída em uma garantia verificada para todas as linhas existentes.

## Erros e auditoria

- Renovação inválida ou concorrente retorna conflito sem alterar a sessão anterior.
- A Edge Function traduz falhas esperadas da RPC para HTTP 409.
- O início bem-sucedido registra atomicamente `session_ended` para a sessão substituída
  e `session_started` para a renovação.
- Falha ao registrar a auditoria aborta também a troca das sessões.
- O job de retenção preserva registros em `legal_hold`.

## Testes

Os testes serão escritos antes da implementação e deverão demonstrar inicialmente as falhas atuais.

### Banco

- renovação aprovada substitui atomicamente uma sessão ativa;
- falha ao ativar a renovação preserva a sessão anterior;
- uma solicitação inicial não pode iniciar com outra sessão ativa;
- solicitante, organização, prazo e vínculo `renewal_of` são validados;
- limpeza exclui somente eventos vencidos sem `legal_hold`;
- job de retenção existe uma única vez;
- `profiles_identity_xor` fica validada;
- migration falha se houver identidade híbrida.

### Edge Function

- `start` usa a RPC transacional;
- conflito da RPC retorna 409;
- renovação bem-sucedida devolve a sessão ativada pela RPC;
- solicitação inicial continua funcionando.

## Implantação

1. Confirmar em produção que todas as identidades atendem ao XOR.
2. Aplicar exclusivamente a migration nova por `supabase db push`.
3. Publicar novamente a função `suporte`.
4. Conferir a versão implantada e a existência de um único job no `cron.job`.
5. Testar primeiro na organização DSA:
   - iniciar sessão;
   - solicitar renovação nos 15 minutos finais;
   - aprovar;
   - iniciar renovação;
   - confirmar que há exatamente uma sessão ativa e duas horas completas.
6. Validar que auditoria contém o encerramento anterior e o início renovado.

## Fora do escopo

- renovação automática sem ação do super-admin;
- alteração dos prazos de 24 horas, 1 hora, 2 horas ou janela final de 15 minutos;
- mudança na interface;
- revisão geral das demais Edge Functions;
- exclusão manual de eventos de auditoria existentes.
