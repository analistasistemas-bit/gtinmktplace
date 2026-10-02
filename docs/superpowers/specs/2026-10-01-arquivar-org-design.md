# Arquivar organização — design (fatia 1)

Decisão e contexto: [ADR-0175](../../decisions/0175-arquivar-organizacao.md).

## Entendimento acordado (Diego, 2026-10-01)

- Quer tirar da Central orgs que não operam mais (caso Hairflay → Hairfly Cosmeticos).
- Escolheu **arquivar** agora; **excluir de verdade** numa fatia 2.
- Org arquivada **para de sincronizar** com o ML. Diego pausa os anúncios antigos no ML antes.
- Sucesso: Hairflay some da Central e dos totais, nenhuma rotina agendada processa a org, histórico
  preservado, ação reversível.

## Componentes

| # | Peça | Arquivo | Responsabilidade |
|---|---|---|---|
| 1 | Migration | `supabase/migrations/<ts>_adr175_arquivar_organizacao.sql` | coluna `arquivada_em`; funções `arquivar_organizacao(uuid)` e `desarquivar_organizacao(uuid)` (security definer, `revoke` de public/anon/authenticated) |
| 2 | Edge `usuarios` | `supabase/functions/usuarios/index.ts` | ações `archive_org` / `unarchive_org` (super-admin sem org, entram em `platformAction`); recusa própria org; auditoria intent + success/failure; `list_orgs` devolve `arquivada_em` |
| 3 | Repositório Central | `supabase/functions/_shared/platform-admin/repository.ts` (+ `types.ts`) | `loadOrganizations` filtra `arquivada_em is null` salvo `include_archived`; `OrgSummary.arquivada_em` |
| 4 | Rotinas | `sincronizar-promocoes/index.ts:72`, `materializar-metricas/index.ts:41` | `.is('arquivada_em', null)` |
| 5 | Front | `src/pages/Organizacoes.tsx` + hook da Central | itens Arquivar/Desarquivar no ⋯, diálogo com slug digitado, filtro "Incluir arquivadas", selo |
| 6 | Tipos | `src/lib/database.types.ts` | coluna nova |

## Função `arquivar_organizacao(p_org_id)` — contrato

1. `select ... for update` na org; inexistente → `raise exception` (P0002).
2. Já arquivada → retorna sem efeito (idempotente).
3. Existe `profiles` com `org_id = p_org_id and is_active` → `raise exception 'org possui membros ativos'`.
4. Para cada `marketplace_connections` da org: apaga os dois segredos do Vault e a linha.
5. `update organizations set arquivada_em = now()`.
Tudo na transação da chamada: falha em qualquer passo desfaz tudo.

`desarquivar_organizacao(p_org_id)`: zera `arquivada_em`; idempotente.

## Erros na edge

- 403 não super-admin; 400 sem `org_id` ou própria org; 404 inexistente; 409 membros ativos
  (mensagem do raise repassada); 500 demais, com auditoria `failure`.

## Testes

- **SQL real (Postgres local, suíte SQL existente):** arquivar com conexão apaga conexão + segredos
  e grava data; recusa com membro ativo sem apagar nada (atomicidade); idempotência; desarquivar.
- **Unitário edge** (padrão dos testes de `usuarios`): travas 403/400/409, auditoria gravada.
- **Repositório:** wallet exclui arquivada por padrão, inclui com flag.
- **Front:** item do menu chama a ação certa; filtro esconde por padrão.

## Fora de escopo

Exclusão definitiva (fatia 2); refatorar as ~10 rotinas para um helper único de conexões.
