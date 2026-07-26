# Plano: identidade Daludi e suporte temporário autorizado

**Fonte de verdade:** ADR-0092  
**Objetivo:** separar a administração da plataforma dos tenants e permitir suporte
temporário somente após autorização explícita do cliente.

## Restrições globais

- Executar tudo no worktree isolado desta sessão.
- Prefixar comandos com `rtk`.
- Menor diff correto; sem dependência nova.
- Autorização e escopo são aplicados no backend e no RLS, nunca apenas na UI.
- Nenhum segredo ou payload integral entra na auditoria.
- TDD: cada comportamento novo nasce com teste que falha antes da implementação.
- Não aplicar migration nem trocar usuários em produção durante a implementação local.
- E-mail usa `fetch` nativo e secrets `RESEND_API_KEY` e `SUPPORT_EMAIL_FROM`.

## Estrutura de arquivos

### Criados

- `supabase/migrations/20260725HHMMSS_support_access.sql`: modelo, constraints,
  índices, helpers RLS e policies.
- `supabase/functions/suporte/index.ts`: API autenticada da máquina de estados.
- `supabase/functions/_shared/suporte-email.ts`: envio HTTP pelo Resend, sem SDK.
- `supabase/functions/_shared/__tests__/suporte-email.test.ts`: contrato do e-mail.
- `supabase/functions/_shared/__tests__/support-auth.test.ts`: resolução de tenant,
  sessão autorizada e escopo.
- `src/lib/suporte.ts`: tipos e cliente da Edge Function.
- `src/stores/support-store.ts`: contexto operacional temporário.
- `src/components/support-route.tsx`: impede rota operacional sem tenant ou sessão.
- `src/components/support-banner.tsx`: tenant, escopo, relógio e encerramento.
- `src/pages/SupportRequests.tsx`: aprovação/rejeição e histórico do cliente.
- `src/lib/__tests__/suporte.test.ts`: contrato do cliente.
- `src/components/__tests__/support-route.test.tsx`: redirecionamentos.
- `src/pages/__tests__/Organizacoes.test.tsx`: solicitação e entrada.
- `src/pages/__tests__/SupportRequests.test.tsx`: aprovação/rejeição/histórico.
- `docs/how-to/migrar-super-admin-daludi.md`: sequência operacional reversível.

### Modificados

- `supabase/functions/_shared/auth.ts`: `requireUserOrg(req, access)` resolve membro
  ou sessão de suporte e bloqueia escrita em leitura.
- Edge Functions mutáveis que usam `requireUserOrg`: passam `{ access: 'write' }`.
- `supabase/functions/usuarios/index.ts`: super-admin sem `org_id` pode listar/criar
  organizações; listagem informa `is_test`; gestão de usuários continua proibida.
- `supabase/config.toml`: registra `functions.suporte` com JWT.
- `src/stores/auth-store.ts`: `Profile.org_id` vira `string | null`.
- `src/App.tsx`: rota de aprovação/histórico e guard de operação.
- `src/components/admin-shell.tsx`: identidade Daludi.
- `src/components/app-shell.tsx`: banner de suporte.
- `src/components/protected-route.tsx`: super-admin sem sessão vai para `/admin`.
- `src/components/menu-guard.tsx` e `src/lib/menus.ts`: sessão autorizada recebe menus
  operacionais; `usuarios` continua proibido ao suporte.
- `src/pages/Organizacoes.tsx`: remove “sua empresa”, marca DSA como Teste e implementa
  solicitação/entrada/estado.
- `src/lib/queries.ts` e `src/hooks/useUploadLote.ts`: usam organização efetiva.
- `src/lib/database.types.ts`: tipos regenerados/ajustados para o novo schema.
- ADR-0092 e glossário: estado final e referências de implementação.

## Interfaces entre tarefas

```ts
export type SupportScope = 'read' | 'full';
export type SupportStatus =
  | 'pending' | 'approved' | 'active' | 'rejected'
  | 'cancelled' | 'expired' | 'revoked' | 'ended';

export interface SupportContext {
  requestId: string;
  orgId: string;
  orgName: string;
  scope: SupportScope;
  expiresAt: string;
}

export async function requireUserOrg(
  req: Request,
  options?: { access?: 'read' | 'write' },
): Promise<{
  userId: string;
  orgId: string;
  isAdmin: boolean;
  support: null | { requestId: string; scope: SupportScope };
}>;
```

A Edge Function `suporte` aceita ações:

```ts
type SupportAction =
  | { action: 'list'; org_id?: string }
  | { action: 'request'; org_id: string; scope: SupportScope; reason: string }
  | { action: 'cancel'; request_id: string }
  | { action: 'decide'; request_id: string; decision: 'approved' | 'rejected' }
  | { action: 'start'; request_id: string }
  | { action: 'end'; request_id: string }
  | { action: 'revoke'; request_id: string }
  | { action: 'context' };
```

## Tarefa 1 — Banco, máquina de estados e RLS

**Responsável:** Terra A  
**Escrita exclusiva:** nova migration.

1. Criar teste SQL transacional na própria migration via funções pequenas verificáveis
   por `db:check`; usar enums/checks para `scope` e `status`.
2. Tornar `profiles.org_id` nulo e adicionar CHECK XOR:
   super-admin sem org; não-super-admin com org.
3. Adicionar `organizations.is_test boolean not null default false` e marcar
   `slug = 'diego-souza'` como teste.
4. Criar `support_requests` com solicitante, org, escopo, motivo, status, decisor,
   timestamps de pendência/aprovação/início/expiração/fim/revogação e referência de
   renovação. Índices parciais impedem duplicidade pendente e mais de uma sessão ativa.
5. Criar `support_audit_events` com org, request, ator, evento, alvo opcional e resultado;
   impedir payload livre e conceder leitura somente a admins do tenant.
6. Reescrever `current_org_id()` para devolver org do membro ou da sessão ativa.
7. Criar `current_support_scope()` e `can_write_current_org()`. Membro regular continua
   escrevendo; suporte escreve apenas com escopo `full`.
8. Alterar policies de INSERT/UPDATE/DELETE das tabelas operacionais e Storage para
   exigir `can_write_current_org()`. SELECT continua por `current_org_id()`.
9. Proteger RPCs mutáveis chamadas pelo cliente com `can_write_current_org()`.
10. Adicionar função de limpeza com retenção de 1 ano, preservando eventos com
    `legal_hold = true`.
11. Validar com `rtk pnpm db:check` e inspeção SQL de grants/policies.

**Aceite:** estados inválidos falham; leitura sem sessão falha; leitura autorizada passa;
escrita em `read` falha; escrita em `full` passa; expiração/revogação volta a negar.

## Tarefa 2 — API, e-mail e autorização das Edge Functions

**Responsável:** Terra B  
**Depende da interface SQL da Tarefa 1.**  
**Escrita exclusiva:** `supabase/functions/**` e `supabase/config.toml`.

1. Escrever testes do resolver de autenticação e do formatador/envio de e-mail.
2. Implementar `requireUserOrg(req, { access })`: membro ativo usa `profile.org_id`;
   super-admin usa somente uma sessão ativa não expirada; `write` exige `full`.
3. Marcar explicitamente como `write` as Edge Functions mutáveis: ingestão, upload,
   publicação, reprocessamento, remoção, respostas, OAuth mutável, reconciliação,
   alteração de status/categoria e invalidação de cache. Funções métricas/sugestões usam
   leitura.
4. Implementar `suporte` com validação server-side, transições condicionais e idempotentes,
   limite de uma pendência por org, 24h pendente, 1h para uso após aprovação, 2h de sessão
   e renovação somente nos 15 minutos finais.
5. `decide`/`revoke` exigem admin ativo da organização; solicitante nunca decide.
6. `full` não habilita ações de usuários, exclusão de org, cobrança/titularidade ou
   transferência de conexão.
7. Inserir notificações in-app para todos os admins ativos e enviar e-mail com link que
   apenas abre o app. Falha de e-mail é auditada e não desfaz a notificação in-app.
8. Enviar e-mail via `fetch` para `https://api.resend.com/emails`; secrets ausentes
   produzem erro operacional explícito, sem vazar segredo.
9. Auditar transições e mutações de suporte com evento, alvo e resultado, nunca payload.
10. Validar testes Deno/Vitest direcionados, `rtk pnpm check:functions` e
    `rtk pnpm lint:functions`.

**Aceite:** API rejeita IDOR, decisão cruzada, autoaprovação, escopo inválido, motivo
vazio, transição repetida e prazo vencido; e-mail não aprova diretamente.

## Tarefa 3 — Contexto, rotas e isolamento no frontend

**Responsável:** Terra C  
**Depende do contrato HTTP da Tarefa 2.**  
**Escrita exclusiva:** stores, rotas, shells, guards, `queries.ts`, upload e seus testes.

1. Escrever testes de cliente, store e guards antes da implementação.
2. Tornar `Profile.org_id` anulável e criar `support-store` com
   `loadContext/start/end`, contexto e relógio derivado.
3. Centralizar `effectiveOrgId()` como sessão autorizada ou `profile.org_id`; substituir
   leituras diretas usadas por cache/configuração/upload.
4. Super-admin sem sessão é redirecionado de rotas operacionais para `/admin`; membro
   regular não muda.
5. Sessão autorizada libera menus operacionais de admin, exceto `usuarios`.
6. Incluir `SupportBanner` persistente e acessível com organização, escopo, expiração e
   encerramento.
7. Em leitura, desabilitar ações mutáveis na UI como feedback; backend/RLS permanece a
   fonte de segurança.
8. Para upload por suporte full, usar path iniciado pelo `effectiveOrgId`; preservar o
   layout antigo de membros e a policy compatível da Tarefa 1.
9. Ao encerrar/expirar, limpar React Query e voltar a `/admin`.
10. Validar testes direcionados, `rtk pnpm tsc` e `rtk pnpm lint`.

**Aceite:** nenhuma rota operacional abre sem tenant/sessão; sessão mostra contexto;
encerramento limpa cache; read não apresenta ação mutável; full preserva operação.

## Tarefa 4 — Organizações, aprovação e histórico

**Responsável:** Terra C após Tarefa 3  
**Escrita exclusiva:** páginas `Organizacoes`/`SupportRequests`, cliente `suporte.ts` e
testes de página.

1. Testar solicitação read/full, estados, entrada aprovada, aprovação, rejeição,
   revogação, histórico e marca Teste.
2. Remover o cálculo/rótulo “sua empresa”.
3. Exibir DSA como **Teste** e adicionar ação **Solicitar acesso** por organização.
4. Dialog exige label associado, motivo e escopo; erros são visíveis e anunciados.
5. Exibir pedido pendente/aprovado/rejeitado/expirado e **Entrar na operação** apenas
   quando aprovado e ainda utilizável.
6. Criar `/admin/suporte` para admins do cliente decidirem solicitações e consultarem
   histórico; link de e-mail termina nessa rota e exige login.
7. Exibir acesso vigente com ação de revogação e primeiro decisor vence.
8. Paginar histórico e lista de eventos; não criar SELECT ilimitado.
9. Validar testes de página, teclado, labels e estados assíncronos.

**Aceite:** fluxos completos funcionam por teclado, sem aprovação por link, sem rótulo
de propriedade incorreto e sem lista ilimitada.

## Tarefa 5 — Integração, tipos, documentação e migração operacional

**Responsável:** Sol/orquestrador.

1. Integrar resultados, resolver contratos e regenerar `database.types.ts`.
2. Atualizar ADR-0092, glossário e criar runbook com backup/consultas de pré-condição,
   convite da nova conta, validação e remoção do privilégio antigo.
3. Não executar a troca real antes de migration/function/frontend estarem implantados e
   `diego@daludi.com.br` ter confirmado login.
4. Rodar verificações finais proporcionais: testes direcionados, testes completos,
   typecheck, lint, check/lint das functions, build e `db:check`.
5. Fazer revisão de segurança/especificação e revisão delete-list.

## Auto-revisão do plano

- **Cobertura do ADR:** critérios 1–10 mapeados às Tarefas 1–5; gaps encontrados e
  corrigidos: Storage em upload de suporte, RPCs mutáveis, cache por tenant e link de
  e-mail autenticado.
- **Placeholders:** nenhum `TBD`, `TODO` ou etapa genérica.
- **Consistência de tipos:** `SupportScope`, `SupportStatus`, `SupportContext`,
  `SupportAction` e `requireUserOrg` têm nomes e assinaturas únicas em todas as tarefas.
- **Comutabilidade:** Tarefas 1–3 têm escopos de escrita distintos; Tarefa 4 sucede a 3;
  Tarefa 5 integra e verifica.
