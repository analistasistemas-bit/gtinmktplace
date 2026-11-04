import { describe, expect, it } from 'vitest';
import { montarSugestoes, type ConvitePromocao, type Dispensa, type SinalAnuncio } from '../sugestoes-promocao';
import type { CorProjetada, Participacao, Promocao } from '../promocoes';

const agoraMs = Date.parse('2026-11-04T12:00:00Z');
const dia = 86_400_000;
const antigo = new Date(agoraMs - 200 * dia).toISOString();

const promo = (o: Partial<Promocao> = {}): Promocao => ({
  promocao_id: 'C1', tipo: 'DEAL', nome: 'Campanha', status: 'started', inicio: null, fim: null, prazo_adesao: null,
  beneficios: null, contagem: null, erro: null, itens_sincronizados_em: null, rodada_em_curso: null, ...o,
});
const cor = (o: Partial<CorProjetada> = {}): CorProjetada => ({
  variation_id: null, cor: null, sku: null, custo: 10, piso: 12, origem: 'nacional', comissao_pct: 14, comissao_fixa: 0,
  frete: 0, aliquota_pct: 4, liquido: 16, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null, ...o,
});
const convite = (o: Partial<ConvitePromocao> = {}): ConvitePromocao => ({
  promocao_id: 'C1', ml_item_id: 'MLB1', status: 'candidate', preco_original: 100, preco_promo: null, preco_min: 10, preco_max: 95,
  preco_sugerido: 80, preco_avaliado: 80, ml_pct: null, estoque_min: null, titulo: 'Produto', thumbnail: null, permalink: null,
  projecao: [cor()], pior_semaforo: 'verde', anuncio_normal_id: null, ...o,
} as ConvitePromocao);
const sinal = (o: Partial<SinalAnuncio> = {}): SinalAnuncio => ({
  ml_item_id: 'MLB1', unidades_30d: 0, visitas_ok: 0, unidades_ok: 0, dias_ok: 30, ativo: true, codigo_pai: 'P1',
  nome_produto: 'Produto', estoque_produto: 10, criado_em: antigo, ...o,
});
/** Conta com 2390 visitas e 100 unidades: 23,9 visitas por unidade. */
const conta = sinal({ ml_item_id: 'MLBX', codigo_pai: 'PX', visitas_ok: 2390, unidades_ok: 100, unidades_30d: 100 });

function montar(o: { convites?: ConvitePromocao[]; sinais?: SinalAnuncio[]; promocoes?: Promocao[]; participacoes?: Participacao[]; dispensas?: Dispensa[] } = {}) {
  return montarSugestoes({
    convites: o.convites ?? [convite()], participacoes: o.participacoes ?? [], promocoes: o.promocoes ?? [promo()],
    sinais: o.sinais ?? [conta, sinal()], dispensas: o.dispensas ?? [], agoraMs,
  });
}

describe('montarSugestoes', () => {
  it('classifica Quase vendendo pelo corte da conta', () => {
    const base = { ...conta, visitas_ok: 2318 };
    const r = montar({ sinais: [base, sinal({ visitas_ok: 72 })] });
    expect(r.visitasPorUnidade).toBeCloseTo(23.9, 1);
    expect(r.quaseVendendo.map((s) => s.chave)).toEqual(['p:P1']);
    const b = montar({ sinais: [base, sinal({ visitas_ok: 71 })] });
    expect(b.invisivel.map((s) => s.chave)).toEqual(['p:P1']);
    expect(b.quaseVendendo).toEqual([]);
  });

  it('visitas no corte e conversão na média fica fora', () => {
    const r = montar({ sinais: [conta, sinal({ visitas_ok: 72, unidades_ok: 4, unidades_30d: 4 })] });
    expect(r.quaseVendendo).toEqual([]);
    expect(r.invisivel).toEqual([]);
  });

  it('piso de 30 visitas', () => {
    const alta = sinal({ ml_item_id: 'MLBX', codigo_pai: 'PX', visitas_ok: 860, unidades_ok: 100, unidades_30d: 100 });
    expect(montar({ sinais: [alta, sinal({ visitas_ok: 29 })] }).invisivel).toHaveLength(1);
    expect(montar({ sinais: [alta, sinal({ visitas_ok: 30 })] }).quaseVendendo).toHaveLength(1);
  });

  it('conta sem vendas', () => {
    const r = montar({ sinais: [sinal({ visitas_ok: 30 })] });
    expect(r.visitasPorUnidade).toBeNull();
    expect(r.quaseVendendo[0]).toMatchObject({ oportunidade: 0, vendasAbaixo: 0 });
  });

  it('oportunidade conta só os anúncios da campanha recomendada', () => {
    const r = montar({
      convites: [convite({ projecao: [cor({ liquido: 16 })] })],
      sinais: [conta, sinal({ visitas_ok: 212, unidades_ok: 1, unidades_30d: 1 }), sinal({ ml_item_id: 'MLB2', visitas_ok: 500 })],
    });
    const s = r.quaseVendendo[0];
    const esperado = 212 / r.visitasPorUnidade! - 1;
    expect(s.vendasAbaixo).toBeCloseTo(esperado, 5);
    expect(s.oportunidade).toBeCloseTo(esperado * 6, 5);
    expect(s.visitas).toBe(712);
  });

  it('produto que vende 5 ou mais sai, mesmo com anúncio individual zerado', () => {
    const r = montar({ sinais: [conta, sinal({ visitas_ok: 100 }), sinal({ ml_item_id: 'MLB2', unidades_30d: 5, unidades_ok: 5 })] });
    expect(r.quaseVendendo).toEqual([]);
    expect(r.invisivel).toEqual([]);
  });

  it('soma anúncios não convidados do produto', () => {
    const r = montar({ sinais: [conta, sinal({ visitas_ok: 10 }), sinal({ ml_item_id: 'MLB2', visitas_ok: 15, unidades_30d: 2, unidades_ok: 2 })] });
    expect(r.invisivel[0]).toMatchObject({ visitas: 25, unidades: 2 });
  });

  it('participante sai, o resto do produto continua', () => {
    const r = montar({
      convites: [convite(), convite({ ml_item_id: 'MLB2' })],
      participacoes: [{ ...convite({ promocao_id: 'C2', status: 'started' }) } as unknown as Participacao],
      promocoes: [promo(), promo({ promocao_id: 'C2' })],
      sinais: [conta, sinal(), sinal({ ml_item_id: 'MLB2' })],
    });
    expect(r.invisivel[0].recomendada.itens.map((i) => i.ml_item_id)).toEqual(['MLB2']);
  });

  it.each([
    ['vermelho', convite({ pior_semaforo: 'vermelho' })],
    ['indisponível', convite({ pior_semaforo: 'indisponivel' })],
    ['cor sem custo', convite({ projecao: [cor({ custo: null })] })],
    ['lucro zero', convite({ projecao: [cor({ liquido: 10 })] })],
    ['preço acima do original', convite({ preco_avaliado: 120 })],
    ['preço igual ao original', convite({ preco_avaliado: 100 })],
  ])('exclui %s', (_n, c) => {
    const r = montar({ convites: [c] });
    expect([...r.quaseVendendo, ...r.invisivel]).toEqual([]);
  });

  it('exclui tipo não operável, campanha encerrada e Relâmpago abaixo de 19', () => {
    const vazio = (p: Promocao, c = convite()) => {
      const r = montar({ promocoes: [p], convites: [c] });
      return [...r.quaseVendendo, ...r.invisivel];
    };
    expect(vazio(promo({ tipo: 'MARKETPLACE_CAMPAIGN' }))).toEqual([]);
    expect(vazio(promo({ status: 'finished' }))).toEqual([]);
    expect(vazio(promo({ tipo: 'LIGHTNING' }), convite({ preco_avaliado: 18.9 }))).toEqual([]);
    expect(vazio(promo({ tipo: 'LIGHTNING' }), convite({ preco_avaliado: 19 }))).toHaveLength(1);
  });

  it('anúncio inativo não entra; estoque zero e cobertura baixa saem; estoque desconhecido entra', () => {
    const quantos = (s: SinalAnuncio) => {
      const r = montar({ sinais: [conta, s] });
      return r.quaseVendendo.length + r.invisivel.length;
    };
    expect(quantos(sinal({ ativo: false }))).toBe(0);
    expect(quantos(sinal({ estoque_produto: 0 }))).toBe(0);
    expect(quantos(sinal({ dias_ok: 23 }))).toBe(0);
    expect(quantos(sinal({ dias_ok: 24 }))).toBe(1);
    expect(quantos(sinal({ estoque_produto: null }))).toBe(1);
  });

  it('recomenda maior desconto; até 2 pontos é empate e ganha o lucro; depois cobertura', () => {
    const opcoes = (a: Partial<ConvitePromocao>, b: Partial<ConvitePromocao>, extra: ConvitePromocao[] = []) => montar({
      promocoes: [promo({ promocao_id: 'A' }), promo({ promocao_id: 'B' })],
      convites: [convite({ promocao_id: 'A', ...a }), convite({ promocao_id: 'B', ...b }), ...extra],
      sinais: [conta, sinal(), sinal({ ml_item_id: 'MLB2' })],
    }).invisivel[0];
    const lucro = (l: number) => [cor({ liquido: 10 + l })];
    const s1 = opcoes({ preco_avaliado: 89.9, projecao: lucro(2) }, { preco_avaliado: 90.1, projecao: lucro(5) });
    expect(s1.recomendada.promocao.promocao_id).toBe('B');
    expect(s1.alternativas.map((a) => a.promocao.promocao_id)).toEqual(['A']);
    const s2 = opcoes({ preco_avaliado: 80, projecao: lucro(2) }, { preco_avaliado: 90, projecao: lucro(5) });
    expect(s2.recomendada.promocao.promocao_id).toBe('A');
    const s3 = opcoes({ preco_avaliado: 90 }, { preco_avaliado: 90 }, [convite({ promocao_id: 'B', ml_item_id: 'MLB2', preco_avaliado: 90 })]);
    expect(s3.recomendada.promocao.promocao_id).toBe('B');
    expect(s3.recomendada.itens).toHaveLength(2);
  });

  it('amarelo entra com semáforo da opção', () => {
    const r = montar({ convites: [convite({ pior_semaforo: 'amarelo' })] });
    expect(r.invisivel[0].recomendada.semaforo).toBe('amarelo');
  });

  it('produto novo sai pela menor data entre todos os sinais; anúncio antigo sem convite mantém; sem data entra', () => {
    const novo = new Date(agoraMs - 10 * dia).toISOString();
    const n = (ss: SinalAnuncio[]) => { const r = montar({ sinais: [conta, ...ss] }); return r.invisivel.length; };
    expect(n([sinal({ criado_em: novo })])).toBe(0);
    expect(n([sinal({ criado_em: novo }), sinal({ ml_item_id: 'MLB2', criado_em: antigo })])).toBe(1);
    expect(n([sinal({ criado_em: null })])).toBe(1);
  });

  it('conversão ignora dia pendente, corte usa todas as unidades', () => {
    const r = montar({ sinais: [conta, sinal({ visitas_ok: 100, unidades_ok: 1, unidades_30d: 4 })] });
    expect(r.quaseVendendo[0]).toMatchObject({ unidades: 4, unidadesOk: 1 });
    expect(r.quaseVendendo[0].vendasAbaixo).toBeCloseTo(100 / r.visitasPorUnidade! - 1, 5);
    expect(r.quaseVendendo[0].vendasEsperadas).toBeCloseTo(100 / r.visitasPorUnidade!, 5);
  });

  it('dispensa vigente vai para dispensadas; expirada volta; chave velha não quebra', () => {
    const d = (ms: number): Dispensa => ({ chave: 'p:P1', expira_em: new Date(agoraMs + ms).toISOString(), dispensado_em: antigo, dispensado_por: null });
    const vigente = montar({ dispensas: [d(dia)] });
    expect(vigente.invisivel).toEqual([]);
    expect(vigente.dispensadas.map((s) => s.chave)).toEqual(['p:P1']);
    expect(montar({ dispensas: [d(-dia)] }).invisivel).toHaveLength(1);
    const orfa = montar({ dispensas: [{ ...d(dia), chave: 'a:MLB1' }] });
    expect(orfa.invisivel).toHaveLength(1);
    expect(orfa.dispensadas).toEqual([]);
  });

  it('par de catálogo cai no produto do normal, sem duplicar card', () => {
    const r = montar({
      convites: [convite({ ml_item_id: 'MLBC', anuncio_normal_id: 'MLB1' }), convite({ ml_item_id: 'MLB1' })],
      sinais: [conta, sinal()],
    });
    expect(r.invisivel).toHaveLength(1);
    expect(r.invisivel[0].anunciosConvidados).toBe(2);
  });

  it('catálogo sem produto próprio herda o do normal e soma os sinais dos dois', () => {
    const catalogo = sinal({ ml_item_id: 'MLBC', codigo_pai: null, estoque_produto: null, nome_produto: null, unidades_30d: 3, unidades_ok: 3 });
    const convites = [convite({ ml_item_id: 'MLBC', anuncio_normal_id: 'MLB1' })];
    const fora = montar({ convites, sinais: [conta, catalogo, sinal({ unidades_30d: 2, unidades_ok: 2 })] });
    expect([...fora.quaseVendendo, ...fora.invisivel]).toEqual([]);
    const zerado = montar({ convites, sinais: [conta, { ...catalogo, unidades_30d: 0, unidades_ok: 0 }, sinal({ estoque_produto: 0 })] });
    expect([...zerado.quaseVendendo, ...zerado.invisivel]).toEqual([]);
    const dentro = montar({ convites, sinais: [conta, { ...catalogo, visitas_ok: 10, unidades_30d: 1, unidades_ok: 1 }, sinal({ visitas_ok: 5 })] });
    expect(dentro.invisivel[0]).toMatchObject({ chave: 'p:P1', visitas: 15, unidades: 1 });
  });

  it('sem vínculo vale o anúncio sozinho', () => {
    const r = montar({ sinais: [conta, sinal({ codigo_pai: null, estoque_produto: null, nome_produto: null })] });
    expect(r.invisivel[0].chave).toBe('a:MLB1');
    expect(r.invisivel[0].titulo).toBe('Produto');
  });

  it('título em maiúsculas sai legível', () => {
    const r = montar({ sinais: [conta, sinal({ nome_produto: 'LINHA PARA COSTURA' })] });
    expect(r.invisivel[0].titulo).toBe('Linha para Costura');
  });

  it('ordena por oportunidade, desempate por visitas', () => {
    const r = montar({
      convites: [convite(), convite({ ml_item_id: 'MLB2' }), convite({ ml_item_id: 'MLB3' })],
      sinais: [conta, sinal({ visitas_ok: 100 }), sinal({ ml_item_id: 'MLB2', codigo_pai: 'P2', visitas_ok: 300 }), sinal({ ml_item_id: 'MLB3', codigo_pai: 'P3', visitas_ok: 200 })],
    });
    expect(r.quaseVendendo.map((s) => s.chave)).toEqual(['p:P2', 'p:P3', 'p:P1']);
  });
});
