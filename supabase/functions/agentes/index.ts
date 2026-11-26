// Acesso de agentes (ADR-0210, fatia 1): servidor MCP público (verify_jwt=false) autenticado por chave de agente.
// Roda com service role, então a RLS não isola nada aqui: TODA dep é fechada no `orgId` que `autenticar` devolveu.
// Só montagem: HTTP em `_shared/agentes/http.ts`, protocolo em `mcp.ts`, regra em `margens.ts`, banco em
// `deps-banco.ts`. Conexão ML e token são preguiçosos e memorizados por requisição (nunca no escopo do módulo):
// alvo inexistente, cursor/preço inválido, sem alíquota ou cota esgotada não renovam token nem tocam o ML.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { criarLeitorPreco } from '../_shared/ml/preco-comprador.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';
import { buscarItensML, criarGetJson, type GetJson } from '../_shared/promocoes/ml.ts';
import { carregarCadastro, criarTarifaEm, lerAliquotas } from '../_shared/promocoes/deps.ts';
import type { QueryTarifa } from '../_shared/promocoes/sincronizar.ts';
import type { Tarifa } from '../_shared/promocoes/tipos.ts';
import { autenticarAgente } from '../_shared/agentes/auth-agente.ts';
import { comDiagnostico } from '../_shared/agentes/diagnostico-tarifa.ts';
import { reservarLeituras, reservarTarifas } from '../_shared/agentes/limite.ts';
import { avisarDono, registrarRecusa } from '../_shared/agentes/recusas.ts';
import { soDoVendedor } from '../_shared/agentes/so-do-vendedor.ts';
import { type DepsMargens, margemDoAlvo, margensDoCatalogo, simularMargem } from '../_shared/agentes/margens.ts';
import { type Ferramentas, ipDoCliente, tratarMcp } from '../_shared/agentes/mcp.ts';
import { tratarRequisicao } from '../_shared/agentes/http.ts';
import {
  buscarConexaoPorHash, buscarPorTitulo, gravarChamada, lerLoja, listarMlbs, marcarUso, orgAtivaComModulo, vinculos,
} from '../_shared/agentes/deps-banco.ts';

// Global do runtime do Supabase: mantém a tarefa viva depois de a resposta sair.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

/** A org não tem conta ML conectada: vira `estado: 'sem_conexao_ml'` na ferramenta. */
class SemConexaoML extends Error {}

/** Status por MLB, em blocos de 20, pelo `get` que confere o vendedor. Bloco que falha só fica sem status. */
async function lerStatus(get: GetJson, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    try {
      const r = comoEnvelopeAntigo(await get(caminhoMultiget(bloco, 'id,status')), bloco);
      for (const e of Array.isArray(r) ? r : []) {
        const b = e?.code === 200 ? e.body : null;
        if (typeof b?.id === 'string' && typeof b.status === 'string' && b.status) m.set(b.id, b.status);
      }
    } catch {
      console.warn('[agentes] status indisponível');
    }
  }
  return m;
}

/** Deps de margem de UMA chamada de ferramenta, fechadas na org; o ML só é tocado na primeira dep que precisa dele. */
function depsMargens(admin: SupabaseClient, orgId: string): DepsMargens {
  type ML = { preco: ReturnType<typeof criarLeitorPreco>; get: GetJson; tarifaEm: (q: QueryTarifa) => Promise<Tarifa> };
  let ml: Promise<ML> | null = null;
  const doML = () => ml ??= (async () => {
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx?.contaExternaId) throw new SemConexaoML();
    const token = await getValidAccessTokenConexao(cx);
    return {
      preco: criarLeitorPreco(token),
      get: soDoVendedor(criarGetJson(token), cx.contaExternaId),
      // Uma instância por chamada: o disjuntor de `semRetentativa` vale para a chamada inteira.
      tarifaEm: comDiagnostico(criarTarifaEm({ orgId, mlUserId: cx.contaExternaId, token }, { semRetentativa: true })),
    };
  })();
  const agora = new Date();
  return {
    orgId,
    resolver: {
      vinculos: (f) => vinculos(admin, orgId, f),
      buscarPorTitulo: (t) => buscarPorTitulo(admin, orgId, t),
    },
    carregarCadastro: () => carregarCadastro(admin, orgId),
    lerAliquotas: () => lerAliquotas(admin, orgId),
    buscarItensML: async (ids) => buscarItensML((await doML()).get, ids),
    lerStatus: async (ids) => lerStatus((await doML()).get, ids),
    lerPrecos: async (ids) => (await doML()).preco.lerPrecos(ids),
    lerFimPromocao: async (alvos) => (await doML()).preco.lerFimPromocao(alvos),
    tarifaEm: async (q) => (await doML()).tarifaEm(q),
    reservarTarifas: (n) => reservarTarifas(orgId, n, agora),
    reservarLeituras: (n) => reservarLeituras(orgId, n, agora),
    listarMlbs: (depois, limite) => listarMlbs(admin, orgId, depois, limite),
    agora,
  };
}

async function comDeps<T>(admin: SupabaseClient, orgId: string, fn: (d: DepsMargens) => Promise<T>) {
  try {
    return await fn(depsMargens(admin, orgId));
  } catch (e) {
    if (e instanceof SemConexaoML) return { estado: 'sem_conexao_ml' } as const;
    throw e;
  }
}

Deno.serve((req) => {
  let cliente: SupabaseClient | null = null;
  const admin = () => cliente ??= adminClient();
  return tratarRequisicao(req, {
    autenticar(r) {
      const agora = new Date();
      return autenticarAgente(r, {
        buscarConexaoPorHash: (hash) => buscarConexaoPorHash(admin(), hash),
        orgAtivaComModulo: (orgId) => orgAtivaComModulo(admin(), orgId),
        marcarUso: (conexaoId, orgId) => marcarUso(admin(), orgId, conexaoId, agora),
        agora,
        ip: ipDoCliente(r),
      });
    },
    // Bot da Daludi no chat do dono do SaaS, como em varrer-anuncios-orfaos.
    aoRecusar: () => EdgeRuntime.waitUntil(registrarRecusa(new Date(), (texto) =>
      avisarDono(Deno.env.get('TELEGRAM_BOT_TOKEN') ?? null, Deno.env.get('TELEGRAM_LEADS_CHAT_ID') ?? null, texto))),
    despachar(corpo, { orgId, conexaoId, permissoes }) {
      const db = admin();
      const ferramentas: Ferramentas = {
        loja: () => lerLoja(db, orgId),
        margem: (id) => comDeps(db, orgId, (d) => margemDoAlvo(id, d)),
        catalogo: (cursor) => comDeps(db, orgId, (d) => margensDoCatalogo(cursor, d)),
        simular: (id, preco) => comDeps(db, orgId, (d) => simularMargem(id, preco, d)),
      };
      return tratarMcp(corpo, ferramentas, (ferramenta, alvo, resultado) =>
        gravarChamada(db, { orgId, conexaoId, ferramenta, alvo, resultado }), permissoes);
    },
  });
});
