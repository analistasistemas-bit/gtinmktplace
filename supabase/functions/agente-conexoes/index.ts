// Acesso de agentes (ADR-0210, fatia 1): o administrador cria, lista e revoga conexões de agente pela tela de
// Configurações. Único lugar em que a chave nasce: volta UMA vez na resposta de `criar`; no banco, só o hash.
// Portões e respostas em `_shared/agentes/conexoes-http.ts`, banco em `conexoes.ts`; aqui só a montagem das deps.
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { gerarChave } from '../_shared/agentes/credencial.ts';
import {
  alterarPermissoes, contarAtivas, expiraEm, inserirConexao, listarChamadas, listarConexoes, revogarConexao,
} from '../_shared/agentes/conexoes.ts';
import { tratarConexoes } from '../_shared/agentes/conexoes-http.ts';

Deno.serve((req) => {
  const admin = adminClient();
  return tratarConexoes(req, {
    identificar: (r) => requireUserOrg(r, { access: 'write' }),
    moduloLigado: (orgId) => exigirModulo(admin, orgId, 'agentes'),
    acoes: {
      contarAtivas: (orgId) => contarAtivas(admin, orgId, new Date()),
      async criar(orgId, userId, { nome, dias, permissoes }) {
        const { chave, prefixo, hash } = await gerarChave();
        const expira_em = expiraEm(new Date(), dias);
        const { id } = await inserirConexao(admin, orgId, { nome, prefixo, hash, criada_por: userId, expira_em, permissoes });
        return { id, chave, prefixo, expira_em };
      },
      listar: (orgId) => listarConexoes(admin, orgId),
      revogar: (orgId, id) => revogarConexao(admin, orgId, id, new Date()),
      alterarPermissoes: (orgId, id, p) => alterarPermissoes(admin, orgId, id, p),
      chamadas: (orgId, id) => listarChamadas(admin, orgId, id),
    },
  });
});
