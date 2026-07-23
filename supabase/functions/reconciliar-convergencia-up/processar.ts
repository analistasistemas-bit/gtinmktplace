// ADR-0088 — Reconciliador de CONVERGÊNCIA: miolo testável (extraído do Deno.serve), mesmo
// padrão de remover-publicado/processar.ts e update-familia-ml/processar.ts. Monta as portas reais
// (`PortasConvergencia`) fechando sobre Supabase + API do ML e roda `reconciliarConvergencia`.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { atualizarFamiliaUP, type VariacaoUP } from '../_shared/user-products/atualizar-familia-up.ts';
import {
  reconciliarConvergencia, type PortasConvergencia, type ClaimResultado, type ResultadoRaiz,
} from '../_shared/user-products/reconciliar-convergencia.ts';

export const CANAL = 'mercado_livre';

export interface ListarDeps { admin: SupabaseClient }

export async function listarRaizesTravadas(deps: ListarDeps, limite: string): Promise<string[]> {
  const { data, error } = await deps.admin.from('anuncios_externos')
    .select('id')
    .eq('canal', CANAL).eq('particao', 0)
    .eq('mudando_composicao', true)
    .lt('atualizado_em', limite);
  if (error) throw new Error(`listar raízes travadas: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

export function criarPortasConvergencia(admin: SupabaseClient, limite: string): PortasConvergencia {
  return {
    claim: async (rootId) => {
      // Re-checa mudando_composicao=true + atualizado_em ainda velho DENTRO do mesmo UPDATE que
      // incrementa reconciliacao_tentativas (RPC) — zero linhas = null = perdeu o claim (outra
      // execução, ou o worker normal, já tocou esta raiz nesse meio-tempo).
      const { data, error } = await admin.rpc('reconciliar_convergencia_claim', {
        p_root_id: rootId, p_atualizado_antes: limite,
      });
      if (error) throw new Error(`claim (${rootId}): ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
      if (!row) return null;
      return {
        rootId,
        orgId: row.org_id as string,
        codigoPai: row.codigo_pai as string,
        titulo: (row.titulo as string | null) ?? null,
        criadoEm: (row.criado_em as string | null) ?? null,
        skusEsperados: Array.isArray(row.skus_esperados) ? (row.skus_esperados as string[]) : [],
        familiaId: (row.mudando_composicao_familia_id as string | null) ?? null,
        tentativas: row.reconciliacao_tentativas as number,
      };
    },
    resumirComposicao: async (claim: ClaimResultado) => {
      // Família EXATA do episódio (nunca inferida por recência, revisão adversarial) — a mesma
      // que o worker normal do UPDATE usaria se o operador clicasse "Reenviar" agora.
      const { data: familiaRow, error: famErr } = await admin.from('familias')
        .select('id, org_id, codigo_pai, categoria_ml_id, descricao_ml, atributos_ml, capa_ml_picture_id, capa2_ml_picture_id, capa3_ml_picture_id, atacado, atacado_status')
        .eq('id', claim.familiaId as string).maybeSingle();
      if (famErr) throw new Error(`resolver família (${claim.familiaId}): ${famErr.message}`);
      if (!familiaRow) throw new Error(`família ${claim.familiaId} não encontrada (referenciada pela raiz mas já apagada?)`);
      const familia = familiaRow as {
        id: string; org_id: string; codigo_pai: string; categoria_ml_id: string | null; descricao_ml: string | null;
        atributos_ml?: unknown; capa_ml_picture_id: string | null; capa2_ml_picture_id: string | null;
        capa3_ml_picture_id: string | null; atacado?: unknown; atacado_status?: string | null;
      };

      const { data: variacoesRaw, error: varErr } = await admin.from('variacoes')
        .select('codigo, cor, estoque, preco_publicacao, gtin, imagem_path, ml_picture_id, peso_gramas, altura_cm, largura_cm, comprimento_cm')
        .eq('familia_id', familia.id).eq('excluida_da_publicacao', false);
      if (varErr) throw new Error(`consultar variações (${familia.id}): ${varErr.message}`);
      const variacoes = (variacoesRaw ?? []) as VariacaoUP[];

      // Validação defensiva (revisão adversarial, 2ª rodada — achado real: excluir da checagem os
      // SKUs "já ativos" NÃO bastava. `reposicao()` em atualizar-composicao.ts roda pra TODO SKU
      // desejado que fica ativo — inclusive os já ativos — e usa `estoquePorSku[sku] ?? 0`: um SKU
      // ativo sem entrada em `variacoes` passaria por essa exceção e teria o estoque ZERADO sem
      // nenhuma intenção real. Portanto TODO SKU esperado precisa ter dado fonte em `variacoes`,
      // sem exceção pra "já ativo" — se algum estiver ausente, falha alto: intervenção manual,
      // nunca criação silenciosa com dado incompleto nem reposição com estoque zero não-intencional.
      const codigosVariacoes = new Set(variacoes.map((v) => v.codigo));
      const semDadoFonte = claim.skusEsperados.filter((sku) => !codigosVariacoes.has(sku));
      if (semDadoFonte.length > 0) {
        throw new Error(
          `SKU(s) ${semDadoFonte.join(', ')} esperado(s) pela composição travada mas ausente(s) das variações atuais da família ${familia.id} — não dá pra criar/repor com segurança (reposição zeraria estoque sem intenção real). Intervenção manual necessária (verifique se a cor foi excluída num re-ingest posterior).`,
        );
      }

      const conexao = await resolverConexao(admin, claim.orgId, CANAL);
      if (!conexao) throw new Error(`organização ${claim.orgId} sem conexão com o Mercado Livre`);
      const conn = getConnector(CANAL);
      const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };

      const resultado = await atualizarFamiliaUP({
        admin, conn, ctx, conexao, familia,
        raiz: { id: claim.rootId, titulo: claim.titulo, criado_em: claim.criadoEm },
        variacoes, somenteEstoque: false, tentativas: claim.tentativas,
        skusDesejadosOverride: claim.skusEsperados,
      });
      // Rede de segurança (revisão adversarial, 2ª rodada — achado real): se o crash original
      // aconteceu DEPOIS de todos os filhos já confirmados ativos mas ANTES do `limparComposicao`
      // da tentativa original, retomar encontra `paraRetirar=[]`/`paraAdicionar=[]` e a saga cai no
      // early-return `sem_mudanca` (atualizar-composicao.ts) — que nunca chama `limparComposicao`,
      // porque no caminho normal (não-resumido) esse ramo roda com a flag JÁ false. `resultado.estado
      // === 'ok'` cobre tanto `concluido` (já limpo por dentro) quanto `sem_mudanca` (não limpo).
      // Forçar a flag pra false aqui é sempre seguro (idempotente se já estava false) e fecha o
      // gap específico do caminho de resumo — sem tocar a saga compartilhada (hot path do UPDATE
      // comum, onde este ramo roda com a flag já false na esmagadora maioria das chamadas).
      if (resultado.estado === 'ok') {
        const { error: limpezaErr } = await admin.from('anuncios_externos')
          .update({ mudando_composicao: false, reconciliacao_tentativas: 0, mudando_composicao_familia_id: null })
          .eq('id', claim.rootId);
        // Lança (revisão adversarial, 3ª rodada — achado real: engolir este erro com console.error
        // fazia o driver reportar 'convergiu' com a raiz AINDA travada em mudando_composicao=true —
        // falsa convergência, e no caminho sem_mudanca o orçamento de tentativas nem se aplica,
        // reclaim eterno). O catch em reconciliarConvergencia já mapeia exceção pra tipo:'erro'.
        if (limpezaErr) throw new Error(`limpeza de segurança falhou (${claim.rootId}): ${limpezaErr.message}`);
      }
      return { estado: resultado.estado };
    },
  };
}

export async function processarConvergencia(admin: SupabaseClient, janelaMs: number): Promise<ResultadoRaiz[]> {
  const limite = new Date(Date.now() - janelaMs).toISOString();
  const rootIds = await listarRaizesTravadas({ admin }, limite);
  const portas = criarPortasConvergencia(admin, limite);
  return reconciliarConvergencia(portas, rootIds);
}
