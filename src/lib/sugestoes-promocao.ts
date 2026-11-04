// ADR-0194 — Sugestões de promoção: regra pura. Entra o que o banco já tem (convites, participações, sinais por
// anúncio, dispensas); sai a lista por faixa. Sem IO: o hook busca, a tela só desenha.
import { abaDa, ehCupom, ehOfertaFixa, ehTipoOperavel, type ItemPromocao, type Participacao, type Promocao } from '@/lib/promocoes';
import { PRECO_MIN_RELAMPAGO } from '@/lib/promocao-simulacao';
import { formatarNomeProduto } from '@/lib/texto';

const VENDE_POUCO_ABAIXO_DE = 5;
const VISITAS_MINIMAS = 30;
const VENDAS_ESPERADAS_MINIMAS = 3;
const COBERTURA_MINIMA = 0.8;
const JANELA_DIAS = 30;
const EMPATE_DESCONTO = 0.02;
const DIA_MS = 86_400_000;

export interface SinalAnuncio {
  ml_item_id: string; unidades_30d: number; visitas_ok: number; unidades_ok: number; dias_ok: number; ativo: boolean;
  codigo_pai: string | null; nome_produto: string | null; estoque_produto: number | null; criado_em: string | null;
}
export interface Dispensa { chave: string; expira_em: string; dispensado_em: string; dispensado_por: string | null }
export type ConvitePromocao = ItemPromocao & { promocao_id: string };
export interface OpcaoCampanha {
  promocao: Promocao; itens: ConvitePromocao[]; descontoPct: number; lucroPorVenda: number; semaforo: 'verde' | 'amarelo';
}
export type FaixaSugestao = 'quase_vendendo' | 'invisivel';
export interface Sugestao {
  chave: string; titulo: string; thumbnail: string | null; faixa: FaixaSugestao; unidades: number; visitas: number;
  estoque: number | null; anunciosConvidados: number; vendasAbaixo: number; oportunidade: number;
  recomendada: OpcaoCampanha; alternativas: OpcaoCampanha[];
}
export interface ResultadoSugestoes {
  quaseVendendo: Sugestao[]; invisivel: Sugestao[]; dispensadas: Sugestao[]; visitasPorUnidade: number | null;
}

const soma = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
const media = <T>(xs: T[], f: (x: T) => number) => soma(xs, f) / xs.length;

/** Menor lucro entre as cores (a pior manda); null se alguma cor não tem custo ou líquido. */
function lucroDaLinha(c: ConvitePromocao): number | null {
  if (c.projecao.length === 0) return null;
  let menor = Infinity;
  for (const cor of c.projecao) {
    if (cor.liquido == null || cor.custo == null || cor.custo <= 0) return null;
    menor = Math.min(menor, cor.liquido - cor.custo);
  }
  return menor;
}

function linhaValida(c: ConvitePromocao, p: Promocao): boolean {
  if (c.pior_semaforo !== 'verde' && c.pior_semaforo !== 'amarelo') return false;
  if (c.preco_avaliado == null || c.preco_original == null || c.preco_avaliado >= c.preco_original) return false;
  if ((p.tipo === 'LIGHTNING' || ehOfertaFixa(p.tipo)) && c.preco_avaliado < PRECO_MIN_RELAMPAGO) return false;
  const lucro = lucroDaLinha(c);
  return lucro != null && lucro > 0;
}

function opcaoDaCampanha(promocao: Promocao, itens: ConvitePromocao[]): OpcaoCampanha {
  return {
    promocao, itens,
    descontoPct: media(itens, (i) => 1 - i.preco_avaliado! / i.preco_original!) * 100,
    lucroPorVenda: media(itens, (i) => lucroDaLinha(i)!),
    semaforo: itens.every((i) => i.pior_semaforo === 'verde') ? 'verde' : 'amarelo',
  };
}

/** Maior desconto com lucro: até 2 pontos do maior é empate, e aí ganha o lucro, depois a cobertura. */
function escolher(opcoes: OpcaoCampanha[]): { recomendada: OpcaoCampanha; alternativas: OpcaoCampanha[] } {
  const maior = Math.max(...opcoes.map((o) => o.descontoPct));
  const empatadas = opcoes.filter((o) => o.descontoPct >= maior - EMPATE_DESCONTO * 100 - 1e-9);
  const recomendada = [...empatadas].sort((a, b) =>
    b.lucroPorVenda - a.lucroPorVenda || b.itens.length - a.itens.length || b.descontoPct - a.descontoPct)[0];
  return { recomendada, alternativas: opcoes.filter((o) => o !== recomendada).sort((a, b) => b.descontoPct - a.descontoPct) };
}

export function montarSugestoes(e: {
  convites: ConvitePromocao[]; participacoes: Participacao[]; promocoes: Promocao[]; sinais: SinalAnuncio[];
  dispensas: Dispensa[]; agoraMs: number;
}): ResultadoSugestoes {
  const { agoraMs } = e;
  const viva = (p: Promocao) => !ehCupom(p.tipo) && ['ativas', 'futuras'].includes(abaDa(p, agoraMs) ?? '');
  const vivas = new Map(e.promocoes.filter(viva).map((p) => [p.promocao_id, p]));
  const participa = new Set(e.participacoes.filter((p) => vivas.has(p.promocao_id)).map((p) => p.ml_item_id));
  const sinalDe = new Map(e.sinais.map((s) => [s.ml_item_id, s]));
  const unidadesConta = soma(e.sinais, (s) => s.unidades_ok);
  const visitasPorUnidade = unidadesConta > 0 ? soma(e.sinais, (s) => s.visitas_ok) / unidadesConta : null;

  const chaveDoSinal = (s: SinalAnuncio) => (s.codigo_pai ? `p:${s.codigo_pai}` : `a:${s.ml_item_id}`);
  const sinaisDa = new Map<string, SinalAnuncio[]>();
  for (const s of e.sinais) sinaisDa.set(chaveDoSinal(s), [...(sinaisDa.get(chaveDoSinal(s)) ?? []), s]);

  // Par de catálogo: a linha do catálogo cai no produto do normal.
  const sinalDoConvite = (c: ConvitePromocao) => sinalDe.get(c.ml_item_id) ?? (c.anuncio_normal_id ? sinalDe.get(c.anuncio_normal_id) : undefined);
  const grupos = new Map<string, ConvitePromocao[]>();
  for (const c of e.convites) {
    const p = vivas.get(c.promocao_id);
    if (!p || !ehTipoOperavel(p.tipo) || participa.has(c.ml_item_id) || !linhaValida(c, p)) continue;
    const s = sinalDoConvite(c);
    if (s && !s.ativo) continue;
    const chave = s ? chaveDoSinal(s) : `a:${c.ml_item_id}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), c]);
  }

  const dispensadasAgora = new Set(e.dispensas.filter((d) => Date.parse(d.expira_em) > agoraMs).map((d) => d.chave));
  const resultado: ResultadoSugestoes = { quaseVendendo: [], invisivel: [], dispensadas: [], visitasPorUnidade };

  for (const [chave, convites] of grupos) {
    const sinais = sinaisDa.get(chave) ?? [];
    if (soma(sinais, (s) => s.unidades_30d) >= VENDE_POUCO_ABAIXO_DE) continue;
    const estoque = sinais.find((s) => s.estoque_produto != null)?.estoque_produto ?? null;
    if (estoque === 0) continue;
    const datas = sinais.flatMap((s) => (s.criado_em ? [Date.parse(s.criado_em)] : []));
    if (datas.length > 0 && agoraMs - Math.min(...datas) < JANELA_DIAS * DIA_MS) continue;
    // Cobertura só dos convidados: anúncio retirado sem coleta não derruba o produto. Falta de dado não vira Invisível.
    const ids = [...new Set(convites.map((c) => c.ml_item_id))];
    const cobertura = media(ids, (id) => (sinalDoConvite(convites.find((c) => c.ml_item_id === id)!)?.dias_ok ?? 0) / JANELA_DIAS);
    if (cobertura < COBERTURA_MINIMA) continue;

    const visitas = soma(sinais, (s) => s.visitas_ok);
    const unidadesOk = soma(sinais, (s) => s.unidades_ok);
    const corte = Math.max(VISITAS_MINIMAS, VENDAS_ESPERADAS_MINIMAS * (visitasPorUnidade ?? 0));
    if (visitas >= corte && visitasPorUnidade != null && unidadesOk >= visitas / visitasPorUnidade) continue;
    const faixa: FaixaSugestao = visitas >= corte ? 'quase_vendendo' : 'invisivel';

    const porCampanha = new Map<string, ConvitePromocao[]>();
    for (const c of convites) porCampanha.set(c.promocao_id, [...(porCampanha.get(c.promocao_id) ?? []), c]);
    const { recomendada, alternativas } = escolher([...porCampanha].map(([id, itens]) => opcaoDaCampanha(vivas.get(id)!, itens)));

    // Só os anúncios da recomendada: visita de anúncio fora da campanha não é venda que ela recupera.
    const daCampanha = [...new Set(recomendada.itens.map((i) => sinalDoConvite(i)).filter((s): s is SinalAnuncio => !!s))];
    const vendasAbaixo = visitasPorUnidade == null ? 0
      : Math.max(0, soma(daCampanha, (s) => s.visitas_ok) / visitasPorUnidade - soma(daCampanha, (s) => s.unidades_ok));

    const sugestao: Sugestao = {
      chave, faixa, visitas, estoque, recomendada, alternativas, vendasAbaixo,
      titulo: formatarNomeProduto(sinais.find((s) => s.nome_produto)?.nome_produto ?? convites[0].titulo) || convites[0].ml_item_id,
      thumbnail: convites.find((c) => c.thumbnail)?.thumbnail ?? null,
      unidades: soma(sinais, (s) => s.unidades_30d),
      anunciosConvidados: ids.length,
      oportunidade: vendasAbaixo * recomendada.lucroPorVenda,
    };
    if (dispensadasAgora.has(chave)) resultado.dispensadas.push(sugestao);
    else (faixa === 'quase_vendendo' ? resultado.quaseVendendo : resultado.invisivel).push(sugestao);
  }

  const ordem = (a: Sugestao, b: Sugestao) => b.oportunidade - a.oportunidade || b.visitas - a.visitas || a.chave.localeCompare(b.chave);
  resultado.quaseVendendo.sort(ordem);
  resultado.invisivel.sort(ordem);
  resultado.dispensadas.sort(ordem);
  return resultado;
}
