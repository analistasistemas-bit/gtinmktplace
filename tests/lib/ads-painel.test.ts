import { describe, expect, it } from 'vitest';
import { montarPainelAds, type FontePainelAds, type GrupoPainel } from '@/lib/ads-painel';

const janela = { desde: '2026-09-01', ate: '2026-09-02' };
const agora = new Date('2026-10-04T15:00:00-03:00');
const dia = (d: string, cost: number, total = 0, direct = 0) =>
  ({ dia: d, cost, clicks: 0, prints: 0, direct_amount: direct, indirect_amount: total - direct, total_amount: total,
     coletado_em: '2026-10-04T12:00:00Z' });
const grupo = (id: number, cost: number, membros: string[], total = 0, direct = 0): GrupoPainel =>
  ({ ad_group_id: id, tipo: 'FAMILY', status: 'ACTIVE', cost, clicks: 0, prints: 0, direct_amount: direct,
     indirect_amount: total - direct, total_amount: total, membros });
const sync = { estado: 'ok', erro: null, ultimo_ok_em: '2026-10-04T14:00:00Z', carga_inicial_ok: true,
  cobertura_desde: '2026-06-29', conta_cobertura_desde: '2026-06-29' };
const base = (f: Partial<FontePainelAds> = {}) => ({
  fonte: { sync, conta: [dia('2026-09-01', 60), dia('2026-09-02', 40)], grupos: [], ...f },
  janela, agora, historicoDesde: '2026-01-01T03:00:00.000Z', baseAcosValidada: true,
  codigosPorMlb: new Map([['MLB1', ['A1']], ['MLB2', ['A2']], ['MLB3', ['B1']], ['MLB4', []]]),
  familiaDoCodigo: new Map([['A1', 'A'], ['A2', 'A'], ['B1', 'B']]),
  lucroPorFamilia: new Map([['A', { nome: 'Fam A', lucro: 250, brutoComCusto: 1000, fonteCusto: 'real' as const }]]),
  lucroConta: { lucro: 300, fonteCusto: 'real' as const },
});

describe('montarPainelAds', () => {
  it('grupo com 2 cores da mesma família vai inteiro para a família; semáforo pelo ACOS direto', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 80, ['MLB1', 'MLB2'], 800, 700)] }));
    expect(p.familias).toHaveLength(1);
    expect(p.familias[0]).toMatchObject({ codigoPai: 'A', custo: 80, vendasTotais: 800, roas: 10, roasDireto: 8.75,
      acos: 0.1, lucroAntes: 250, resultado: 170, margemConsumida: 0.32, acosEquilibrio: 0.25, semaforo: 'dentro',
      custoCompartilhado: 0, motivo: null });
    expect(p.familias[0].acosDireto).toBeCloseTo(80 / 700);
  });
  it('identidade exata: famílias + compartilhado + não identificado = total da conta', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1']), grupo(2, 20, ['MLB1', 'MLB3']), grupo(3, 10, [])] }));
    const c = p.conta!;
    expect(c).toMatchObject({ custo: 100, emFamilias: 50, compartilhado: 20, naoIdentificado: 30, naoIdentificadoPct: 0.3,
      divergente: false, resultado: 200 });
    expect(c.emFamilias + c.compartilhado + c.naoIdentificado!).toBe(c.custo);
    expect(p.compartilhados[0]).toMatchObject({ id: 2, familias: ['A', 'B'], semCodigo: 0 });
  });
  it('família tocada por grupo compartilhado: gasto exclusivo visível, resultado bloqueado, sem rateio', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1'], 500, 500), grupo(2, 20, ['MLB1', 'MLB3'])] }));
    const a = p.familias.find((f) => f.codigoPai === 'A')!;
    expect(a).toMatchObject({ custo: 50, custoCompartilhado: 20, resultado: null, margemConsumida: null, semaforo: null,
      motivo: 'compartilhado' });
  });
  it('MLB sem código → compartilhado, nunca a família', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1', 'MLB4'])] }));
    expect(p.familias.find((f) => f.codigoPai === 'A')?.custo ?? 0).toBe(0);
    expect(p.compartilhados[0]).toMatchObject({ semCodigo: 1 });
  });
  it('MLB ausente do mapa (buscarCodigosMlbs omite MLB sem código) → igual a sem código', () => {
    const b = base({ grupos: [grupo(1, 50, ['MLB1', 'MLB4'])] });
    b.codigosPorMlb.delete('MLB4');
    const p = montarPainelAds(b);
    expect(p.familias.find((f) => f.codigoPai === 'A')?.custo ?? 0).toBe(0);
    expect(p.compartilhados[0]).toMatchObject({ semCodigo: 1 });
  });
  it('grupos acima da conta → divergente: nada ajustado, não identificado indisponível', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 101, ['MLB1'])] }));
    expect(p.conta).toMatchObject({ custo: 100, emFamilias: 101, divergente: true, naoIdentificado: null, naoIdentificadoPct: null });
  });
  it('um centavo acima da conta já é divergência', () => {
    expect(montarPainelAds(base({ grupos: [grupo(1, 100.01, ['MLB1'])] })).conta?.divergente).toBe(true);
  });
  it('ruído de ponto flutuante abaixo do centavo não é divergência, e a identidade fecha em centavos', () => {
    const p = montarPainelAds(base({ conta: [dia('2026-09-01', 0.1), dia('2026-09-02', 0.2)],
      grupos: [grupo(1, 0.1, ['MLB1']), grupo(2, 0.2 + 1e-12, ['MLB3'])] }));
    const c = p.conta!;
    expect(c.divergente).toBe(false);
    expect(Math.round(c.emFamilias * 100) + Math.round(c.compartilhado * 100) + Math.round(c.naoIdentificado! * 100))
      .toBe(Math.round(c.custo * 100));
    expect(c.naoIdentificado).toBe(0);
  });
  it('série da conta sem cobrir o período → conta null, famílias continuam', () => {
    const p = montarPainelAds(base({ conta: [dia('2026-09-02', 40)], grupos: [grupo(1, 50, ['MLB1'])] }));
    expect(p.conta).toBeNull();
    expect(p.contaMotivo).toBe('cobertura');
    expect(p.familias).toHaveLength(1);
  });
  it('grupos sem cobertura do período (coleta ainda não leu ontem) → resultado e semáforo indisponíveis', () => {
    const p = montarPainelAds(base({ sync: { ...sync, ultimo_ok_em: '2026-09-02T14:00:00Z' }, grupos: [grupo(1, 50, ['MLB1'], 500, 500)] }));
    expect(p.gruposCobertos).toBe(false);
    expect(p.familias[0]).toMatchObject({ resultado: null, semaforo: null, motivo: 'cobertura' });
  });
  it('período antes do histórico de vendas → lucro desconhecido, nunca zero', () => {
    const b = base({ grupos: [grupo(1, 30, ['MLB3'])] });
    b.historicoDesde = '2026-09-02T03:00:00.000Z';
    const p = montarPainelAds(b);
    expect(p.familias[0]).toMatchObject({ lucroAntes: null, resultado: null, motivo: 'historico' });
    expect(p.conta?.lucroAntes).toBeNull();
  });
  it('histórico começando no meio do 1º dia do período bloqueia (ISO, não dia)', () => {
    const b = base({ grupos: [grupo(1, 30, ['MLB3'])] });
    b.historicoDesde = '2026-09-01T15:00:00.000Z';   // 12:00 BRT do 1º dia
    expect(montarPainelAds(b).familias[0].motivo).toBe('historico');
    b.historicoDesde = '2026-09-01T03:00:00.000Z';   // 00:00 BRT exato: coberto
    expect(montarPainelAds(b).familias[0].motivo).toBe('sem_vendas');
  });
  it('conta sem nenhuma venda faturável: lucro 0, resultado −despesa', () => {
    const b = base();
    b.lucroConta = { lucro: 0, fonteCusto: 'real' };
    b.lucroPorFamilia = new Map();
    expect(montarPainelAds(b).conta).toMatchObject({ lucroAntes: 0, resultado: -100 });
  });
  it('base do ACOS não validada: equilíbrio exibido, semáforo desligado', () => {
    const b = base({ grupos: [grupo(1, 80, ['MLB1', 'MLB2'], 800, 700)] });
    b.baseAcosValidada = false;
    const p = montarPainelAds(b);
    expect(p.semaforoLiberado).toBe(false);
    expect(p.familias[0]).toMatchObject({ acosEquilibrio: 0.25, semaforo: null, motivo: null });
  });
  it('família com gasto e sem venda: lucro 0, resultado −gasto, sem equilíbrio', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 30, ['MLB3'])] }));
    expect(p.familias[0]).toMatchObject({ codigoPai: 'B', lucroAntes: 0, resultado: -30, acosEquilibrio: null,
      semaforo: null, motivo: 'sem_vendas', roas: 0, acos: null });
  });
  it('família só com canceladas/devolvidas (lucro null, fonte real) → sem vendas', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'])] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: null, brutoComCusto: 0, fonteCusto: 'real' });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: 0, motivo: 'sem_vendas' });
  });
  it('margem ≤ 0 → sem espaço para Ads', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100, 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: -5, brutoComCusto: 100, fonteCusto: 'real' });
    expect(montarPainelAds(b).familias[0].semaforo).toBe('sem_espaco');
  });
  it('ACOS direto acima do equilíbrio → acima (mesmo com ACOS total dentro)', () => {
    const f = montarPainelAds(base({ grupos: [grupo(1, 300, ['MLB1'], 2000, 1000)] })).familias[0];
    expect(f.acos).toBe(0.15);
    expect(f.semaforo).toBe('acima');
  });
  it('custo parcial → lucro mostrado, semáforo indisponível', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100, 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: 20, brutoComCusto: 80, fonteCusto: 'parcial' });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: 20, acosEquilibrio: null, semaforo: null, motivo: 'custo_parcial' });
  });
  it('sem custo cadastrado → lucro null com motivo', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: null, brutoComCusto: 0, fonteCusto: 'sem_custo' });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: null, resultado: null, motivo: 'sem_custo' });
  });
  it('dias com atribuição em aberto contam como provisórios', () => {
    const p = montarPainelAds(base({ conta: [{ ...dia('2026-09-01', 60), coletado_em: '2026-09-05T12:00:00Z' },
      dia('2026-09-02', 40)] }));
    expect(p.conta?.diasAbertos).toBe(1);
  });
  it('estados na ordem de precedência', () => {
    expect(montarPainelAds(base({ sync: null })).estado).toBe('sem_coleta');
    expect(montarPainelAds(base({ sync: { ...sync, estado: 'sem_advertiser', carga_inicial_ok: false } })).estado).toBe('sem_advertiser');
    expect(montarPainelAds(base({ sync: { ...sync, carga_inicial_ok: false } })).estado).toBe('coletando');
    expect(montarPainelAds(base({ conta: [dia('2026-09-01', 0), dia('2026-09-02', 0)] })).estado).toBe('sem_ads');
    expect(montarPainelAds(base({ conta: [dia('2026-09-02', 0)] })).estado).toBe('ok');   // sem cobertura não afirma zero
    expect(montarPainelAds(base({ sync: { ...sync, ultimo_ok_em: '2026-10-01T00:00:00Z' } })).desatualizado).toBe(true);
  });
  it('famílias ordenadas por gasto', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 10, ['MLB1']), grupo(2, 50, ['MLB3'])] }));
    expect(p.familias.map((f) => f.codigoPai)).toEqual(['B', 'A']);
  });
});
