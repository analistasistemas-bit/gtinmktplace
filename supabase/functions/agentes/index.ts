// Acesso de agentes (ADR-0210, fatia 1): servidor MCP público (verify_jwt=false) autenticado por chave de agente.
// Roda com service role, então a RLS não isola nada aqui: TODA dep é fechada no `orgId` que `autenticar` devolveu.
// Só montagem: HTTP em `_shared/agentes/http.ts`, protocolo em `mcp.ts`, regra em `margens.ts`, banco em
// `deps-banco.ts`. Conexão ML e token são preguiçosos e memorizados por requisição (nunca no escopo do módulo):
// alvo inexistente, cursor/preço inválido, sem alíquota ou cota esgotada não renovam token nem tocam o ML.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { adminClient } from '../_shared/supabase.ts';
import { enviarTelegram } from '../_shared/notificacoes/telegram.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { caminhoMultiget } from '../_shared/ml/multiget.ts';
import { buscarItensML, criarGetJson, type GetJson } from '../_shared/promocoes/ml.ts';
import { carregarCadastro, criarTarifaEm, lerAliquotas } from '../_shared/promocoes/deps.ts';
import type { QueryTarifa } from '../_shared/promocoes/sincronizar.ts';
import type { Tarifa } from '../_shared/promocoes/tipos.ts';
import { CAMPOS_ITEM_AGORA, type ItemAgora, parseItensBulk } from '../_shared/ads/campanhas.ts';
import { autenticarAgente } from '../_shared/agentes/auth-agente.ts';
import { reservarLeituras, reservarTarifas } from '../_shared/agentes/limite.ts';
import { registrarRecusa } from '../_shared/agentes/recusas.ts';
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

/** Preço e preço de tabela agora, em blocos de 20. Bloco que falha fica desconhecido (vira `anuncio_indisponivel`). */
async function lerPrecos(get: GetJson, ids: string[]): Promise<Map<string, ItemAgora>> {
  const m = new Map<string, ItemAgora>();
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    try {
      for (const [k, v] of parseItensBulk(await get(caminhoMultiget(bloco, CAMPOS_ITEM_AGORA)), bloco)) m.set(k, v);
    } catch {
      console.warn('[agentes] items/bulk indisponível');
    }
  }
  return m;
}

/** Deps de margem de UMA chamada de ferramenta, fechadas na org; o ML só é tocado na primeira dep que precisa dele. */
function depsMargens(admin: SupabaseClient, orgId: string): DepsMargens {
  type ML = { get: GetJson; tarifaEm: (q: QueryTarifa) => Promise<Tarifa> };
  let ml: Promise<ML> | null = null;
  const doML = () => ml ??= (async () => {
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx?.contaExternaId) throw new SemConexaoML();
    const token = await getValidAccessTokenConexao(cx);
    return {
      get: soDoVendedor(criarGetJson(token), cx.contaExternaId),
      // Uma instância por chamada: o disjuntor de `semRetentativa` vale para a chamada inteira.
      tarifaEm: criarTarifaEm({ orgId, mlUserId: cx.contaExternaId, token }, { semRetentativa: true }),
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
    lerPrecos: async (ids) => lerPrecos((await doML()).get, ids),
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
      enviarTelegram(Deno.env.get('TELEGRAM_BOT_TOKEN') ?? null, Deno.env.get('TELEGRAM_LEADS_CHAT_ID') ?? null, texto))),
    despachar(corpo, { orgId, conexaoId }) {
      const db = admin();
      const ferramentas: Ferramentas = {
        loja: () => lerLoja(db, orgId),
        margem: (id) => comDeps(db, orgId, (d) => margemDoAlvo(id, d)),
        catalogo: (cursor) => comDeps(db, orgId, (d) => margensDoCatalogo(cursor, d)),
        simular: (id, preco) => comDeps(db, orgId, (d) => simularMargem(id, preco, d)),
      };
      return tratarMcp(corpo, ferramentas, (ferramenta, alvo, resultado) =>
        gravarChamada(db, { orgId, conexaoId, ferramenta, alvo, resultado }));
    },
  });
});
