// Acesso de agentes (ADR-0210, fatia 1): servidor MCP público (verify_jwt=false) autenticado por chave de agente.
// Roda com service role, então a RLS não isola nada aqui: TODA dep é fechada no `orgId` que veio da linha da
// conexão autenticada. Só fiação: protocolo em `_shared/agentes/mcp.ts`, regra em `margens.ts`, banco em
// `deps-banco.ts`. Sem CORS: clientes MCP chamam servidor-a-servidor; OPTIONS cai no 405.
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { caminhoMultiget } from '../_shared/ml/multiget.ts';
import { buscarItensML, criarGetJson, type GetJson } from '../_shared/promocoes/ml.ts';
import { carregarCadastro, criarTarifaEm, lerAliquotas } from '../_shared/promocoes/deps.ts';
import { CAMPOS_ITEM_AGORA, type ItemAgora, parseItensBulk } from '../_shared/ads/campanhas.ts';
import { autenticarAgente } from '../_shared/agentes/auth-agente.ts';
import { reservarTarifas } from '../_shared/agentes/limite.ts';
import { type DepsMargens, margemDoAlvo, margensDoCatalogo, simularMargem } from '../_shared/agentes/margens.ts';
import { type Ferramentas, erroParse, ipDoCliente, lerCorpoLimitado, tratarMcp } from '../_shared/agentes/mcp.ts';
import {
  buscarConexaoPorHash, buscarPorTitulo, gravarChamada, lerLoja, listarMlbs, marcarUso, orgAtivaComModulo, vinculos,
} from '../_shared/agentes/deps-banco.ts';

const MAX_CORPO = 65_536;
const SEM_CONEXAO_ML = { estado: 'sem_conexao_ml' } as const;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'metodo_nao_permitido' }, 405, { Allow: 'POST' });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CORPO) return json({ erro: 'corpo_grande' }, 413);
  try {
    const admin = adminClient();
    const agoraAuth = new Date();
    const auth = await autenticarAgente(req, {
      buscarConexaoPorHash: (hash) => buscarConexaoPorHash(admin, hash),
      orgAtivaComModulo: (orgId) => orgAtivaComModulo(admin, orgId),
      marcarUso: (conexaoId, orgId) => marcarUso(admin, orgId, conexaoId, agoraAuth),
      agora: agoraAuth,
      ip: ipDoCliente(req),
    });
    if (!auth.ok) {
      const extra: Record<string, string> = auth.status === 401 ? { 'WWW-Authenticate': 'Bearer' }
        : auth.status === 429 ? { 'Retry-After': '60' } : {};
      return json({ erro: auth.codigo }, auth.status, extra);
    }
    const { orgId, conexaoId } = auth;

    const texto = await lerCorpoLimitado(req, MAX_CORPO);
    if (texto === null) return json({ erro: 'corpo_grande' }, 413);
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      const r = erroParse();
      return json(r.corpo, r.status);
    }

    // Conexão ML e token só quando uma ferramenta de margem roda; `agora` nasce logo antes da leitura de preços.
    const depsMargens = async (): Promise<DepsMargens | null> => {
      const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
      if (!cx?.contaExternaId) return null;
      const token = await getValidAccessTokenConexao(cx);
      const get = criarGetJson(token);
      const agora = new Date();
      return {
        orgId,
        resolver: {
          vinculos: (f) => vinculos(admin, orgId, f),
          buscarPorTitulo: (t) => buscarPorTitulo(admin, orgId, t),
        },
        carregarCadastro: () => carregarCadastro(admin, orgId),
        lerAliquotas: () => lerAliquotas(admin, orgId),
        buscarItensML: (ids) => buscarItensML(get, ids),
        lerPrecos: (ids) => lerPrecos(get, ids),
        tarifaEm: criarTarifaEm({ orgId, mlUserId: cx.contaExternaId, token }, { semRetentativa: true }),
        reservarTarifas: (n) => reservarTarifas(orgId, n, agora),
        listarMlbs: (depois, limite) => listarMlbs(admin, orgId, depois, limite),
        agora,
      };
    };
    const comDeps = async <T>(fn: (d: DepsMargens) => Promise<T>) => {
      const d = await depsMargens();
      return d ? fn(d) : SEM_CONEXAO_ML;
    };
    const ferramentas: Ferramentas = {
      loja: () => lerLoja(admin, orgId),
      margem: (id) => comDeps((d) => margemDoAlvo(id, d)),
      catalogo: (cursor) => comDeps((d) => margensDoCatalogo(cursor, d)),
      simular: (id, preco) => comDeps((d) => simularMargem(id, preco, d)),
    };
    const r = await tratarMcp(corpo, ferramentas, (ferramenta, alvo, resultado) =>
      gravarChamada(admin, { orgId, conexaoId, ferramenta, alvo, resultado }));
    return r.corpo === null ? new Response(null, { status: r.status }) : json(r.corpo, r.status);
  } catch {
    // Sem a mensagem: pode carregar dado de outra camada.
    console.error('[agentes] falha inesperada');
    return json({ erro: 'indisponivel' }, 503);
  }
});
