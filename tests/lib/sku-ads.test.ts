import { describe, expect, it } from 'vitest';
import { atribuicaoFinal, montarAds } from '@/lib/sku-ads';
import { intervalosBRT } from '@/lib/calendario-brt';
import type { AdsDia, AdsGrupo, AdsSync, FonteAds } from '@/lib/sku-dossie-dados';

const AGORA = new Date('2026-09-27T15:00:00Z'); // 12:00 BRT → hoje 27/09, ontem 26/09
const JANELA = { desde: '2026-09-14T03:00:00.000Z', ate: '2026-09-28T02:59:59.999Z' };
// Semanas BRT de 14/09 (14..20) e 21/09 (21..27; o dia 27 é hoje e nunca entra).
const IVS = intervalosBRT(JANELA.desde, JANELA.ate, 'semana', AGORA);
const SYNC: AdsSync = {
  estado: 'ok', erro: null, ultimo_ok_em: '2026-09-27T14:20:00Z', carga_inicial_ok: true, cobertura_desde: '2026-06-29',
  custo_resumo: 100, custo_listado: 100,
};

function dia(id: number, d: string, o: Partial<AdsDia> = {}): AdsDia {
  return { ad_group_id: id, dia: d, cost: 0, clicks: 0, prints: 0, direct_amount: 0, indirect_amount: 0, total_amount: 0,
    direct_units: 0, units: 0, coletado_em: '2026-09-27T14:20:00Z', ...o };
}
/** Uma linha por dia de `de` a `ate` (dias de set/2026), como a série densa que o worker grava. */
const diasDe = (id: number, de: number, ate: number, o: Partial<AdsDia> = {}): AdsDia[] =>
  Array.from({ length: ate - de + 1 }, (_, k) => dia(id, `2026-09-${String(de + k).padStart(2, '0')}`, o));
const grupo = (id: number, tipo: AdsGrupo['tipo'] = 'FAMILY'): AdsGrupo =>
  ({ ad_group_id: id, tipo, external_id: String(4000000 + id), campaign_id: 2000001, status: 'ACTIVE', atualizado_em: '2026-09-27T14:20:00Z' });
function fonte(p: { membros: [number, string][]; codigos: Record<string, string[]>; dias?: AdsDia[]; sync?: AdsSync | null }): FonteAds {
  const ids = [...new Set(p.membros.map(([id]) => id))];
  return {
    sync: p.sync === undefined ? SYNC : p.sync,
    grupos: ids.map((id) => grupo(id)),
    membros: p.membros.map(([ad_group_id, ml_item_id]) => ({ ad_group_id, ml_item_id })),
    dias: p.dias ?? [],
    codigosDosMembros: new Map(Object.entries(p.codigos)),
  };
}
type Entrada = Parameters<typeof montarAds>[0];
const monta = (o: Partial<Entrada> & Pick<Entrada, 'fonte'>) => montarAds({
  alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], mlbs: new Map([['MLB1', ['A']]]),
  intervalos: IVS, janela: JANELA, lucroPeriodo: 500, fonteCusto: 'real', agora: AGORA,
  resumo: 'carregando', diasFinanceiros: DIAS_FIN, ...o,
});
const DIAS_FIN = { desde: '2026-09-14', ate: '2026-09-26' };
const DIAS = 13;
/** Caso ok exclusivo: grupo só do SKU, período inteiramente coberto. */
const fOk = fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: diasDe(11, 14, 26, { cost: 1 }) });
const entrada = { fonte: fOk };

describe('atribuicaoFinal', () => {
  it('fecha só quando o dia foi relido 15+ dias depois dele (D-1 + 14 de atribuição)', () => {
    expect(atribuicaoFinal('2026-09-15', '2026-09-27T14:20:00Z')).toBe(false);
    expect(atribuicaoFinal('2026-09-15', '2026-09-29T14:20:00Z')).toBe(false);
    expect(atribuicaoFinal('2026-09-15', '2026-09-30T14:20:00Z')).toBe(true);
  });
});

describe('montarAds', () => {
  it('sku: grupo ITEM antigo + FAMILY novo do mesmo MLB somam os dois; ROAS/ACOS/CPC por Σ, nunca média', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1'], [12, 'MLB1']], codigos: { MLB1: ['A'] }, dias: [
      dia(11, '2026-09-15', { cost: 10, total_amount: 100, direct_amount: 100, clicks: 5, units: 2 }),
      dia(12, '2026-09-16', { cost: 90, total_amount: 90, indirect_amount: 90, clicks: 45, units: 1 }),
    ] }) });
    expect(a.alcance).toBe('sku');
    expect(a.estado).toBe('ok');
    expect(a.totais).toMatchObject({ custo: 100, vendasTotais: 190, vendasDiretas: 100, vendasIndiretas: 90, cliques: 50, unidades: 3 });
    expect(a.totais!.roas).toBeCloseTo(1.9);   // média dos ROAS diários seria 5,5
    expect(a.totais!.acos).toBeCloseTo(100 / 190);
    expect(a.totais!.cpc).toBeCloseTo(2);
    expect(a.lucroAposAds).toBe(400);
    expect(a.motivoSemLucro).toBeNull();
    expect(a.grupos.map((g) => [g.id, g.custo, g.exclusivo])).toEqual([[12, 90, true], [11, 10, true]]);
    // Série diária: 14/09 a 26/09 (hoje fora); dia coberto sem linha = gasto zero real (o worker não grava dia sem gasto).
    expect(a.serieDiaria.map((p) => p.intervalo.rotulo)).toEqual(
      ['14/09', '15/09', '16/09', '17/09', '18/09', '19/09', '20/09', '21/09', '22/09', '23/09', '24/09', '25/09', '26/09']);
    expect(a.serieDiaria.slice(0, 3).map((p) => p.custo)).toEqual([0, 10, 90]);
    expect(a.serie.map((p) => p.custo)).toEqual([100, 0]);
  });

  it('família: grupo alcançado por dois MLBs da família conta uma vez só (dedup por ad_group_id)', () => {
    const f = fonte({ membros: [[21, 'MLB1'], [21, 'MLB2']], codigos: { MLB1: ['A'], MLB2: ['B'] },
      dias: [dia(21, '2026-09-15', { cost: 50 }), dia(21, '2026-09-15', { cost: 50 })] });
    const a = monta({ alvo: { tipo: 'familia', codigoPai: 'P' }, codigos: ['A', 'B'],
      mlbs: new Map([['MLB1', ['A']], ['MLB2', ['B']]]), fonte: f });
    expect(a.alcance).toBe('familia');
    expect(a.totais!.custo).toBe(50);
    expect(a.grupos).toHaveLength(1);
    expect(a.lucroAposAds).toBe(450);
  });

  it('SKU em grupo com outro código: mostra o gasto do grupo, lucro após Ads indisponível', () => {
    const a = monta({ fonte: fonte({ membros: [[21, 'MLB1'], [21, 'MLB2']], codigos: { MLB1: ['A'], MLB2: ['B'] },
      dias: [dia(21, '2026-09-15', { cost: 50 })] }) });
    expect(a.alcance).toBe('anuncio');
    expect(a.totais!.custo).toBe(50);
    expect(a.lucroAposAds).toBeNull();
    expect(a.motivoSemLucro).toBe('compartilhado');
    expect(a.compartilhadoCom).toEqual({ codigos: ['B'], semVinculo: 0 });
  });

  it('membro sem código resolvido (catálogo sem venda, anúncio fora do app) impede o sku', () => {
    const a = monta({ fonte: fonte({ membros: [[31, 'MLB1'], [31, 'MLB9']], codigos: { MLB1: ['A'] },
      dias: [dia(31, '2026-09-15', { cost: 5 })] }) });
    expect(a.alcance).toBe('anuncio');
    expect(a.grupos[0]).toMatchObject({ exclusivo: false, semVinculo: 1 });
    expect(a.compartilhadoCom).toEqual({ codigos: [], semVinculo: 1 });
  });

  it('atribuição em aberto vem do coletado_em; com o worker parado o dia continua em aberto', () => {
    const f = fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: diasDe(11, 14, 20, { cost: 5 }) });
    const hoje = monta({ fonte: f });
    expect(hoje.serie[0].aberto).toBe(true);
    expect(hoje.diasAbertos).toBeGreaterThan(0);
    const parado = monta({ fonte: f, agora: new Date('2026-10-20T15:00:00Z') });
    expect(parado.estado).toBe('desatualizado');
    expect(parado.serie[0].aberto).toBe(true); // lido quando tinha 12 dias: não fechou
  });

  it('hoje nunca entra, nem se houver linha', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: [dia(11, '2026-09-27', { cost: 999 })] }) });
    expect(a.totais!.custo).toBe(0);
    expect(a.estado).toBe('sem_ads');
  });

  it('cobertura: intervalo antes da carga fica sem dado; despesa só soma dia coberto (mesmo recorte do gráfico)', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, sync: { ...SYNC, cobertura_desde: '2026-09-16' },
      dias: [dia(11, '2026-09-15', { cost: 7 }), ...diasDe(11, 21, 26)] }) });
    expect(a.serie[0].custo).toBeNull();
    expect(a.serie[1].custo).toBe(0);      // zero porque o ML devolveu as linhas com cost 0
    expect(a.totais!.custo).toBe(0);       // os R$ 7 de 15/09 estão antes da cobertura: fora da despesa
    expect(a.lucroAposAds).toBeNull();
    expect(a.motivoSemLucro).toBe('cobertura');
  });

  it('dia coberto sem linha = zero medido; fora da cobertura = sem dado; carga parcial não desenha', () => {
    const f = fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: diasDe(11, 21, 25, { cost: 3, total_amount: 9 }) });
    const a = monta({ fonte: f });
    expect(a.serie[1]).toMatchObject({ custo: 15, vendas: 45 }); // 26/09 sem linha entra como 0
    expect(a.serieDiaria.find((p) => p.intervalo.rotulo === '26/09')).toMatchObject({ custo: 0, vendas: 0 });
    const fora = monta({ fonte: { ...f, sync: { ...SYNC, cobertura_desde: '2026-09-22' } } });
    expect(fora.serie[1].custo).toBeNull();                   // 21/09 antes da cobertura
    expect(fora.serieDiaria.find((p) => p.intervalo.rotulo === '21/09')!.custo).toBeNull();
    expect(fora.serieDiaria.find((p) => p.intervalo.rotulo === '26/09')!.custo).toBe(0);
    const parcial = monta({ fonte: { ...f, sync: { ...SYNC, carga_inicial_ok: false, cobertura_desde: null } } });
    expect([...parcial.serie, ...parcial.serieDiaria].every((p) => p.custo === null)).toBe(true);
  });

  it('gasto da conta fora dos grupos no período: lucro após Ads aparece, com o % não identificado', () => {
    const a = monta({ ...entrada, resumo: { custo_conta: 200, dias_conta: DIAS, custo_grupos_com_membro: 190 } });
    expect(a.motivoSemLucro).toBeNull();
    expect(a.lucroAposAds).not.toBeNull();
    expect(a.naoIdentificadoPct).toBeCloseTo(0.05);
    expect(a.naoIdentificadoMotivo).toBeNull();
  });
  it('série da conta incompleta no período financeiro → % null, lucro após Ads continua', () => {
    const a = monta({ ...entrada, resumo: { custo_conta: 200, dias_conta: DIAS - 1, custo_grupos_com_membro: 190 } });
    expect(a.naoIdentificadoPct).toBeNull();
    expect(a.naoIdentificadoMotivo).toBe('incompleto');
    expect(a.lucroAposAds).not.toBeNull();
  });
  it('resumo carregando ou com erro → % null, sem bloquear', () => {
    expect(monta({ ...entrada, resumo: 'erro' })).toMatchObject({ naoIdentificadoPct: null, naoIdentificadoMotivo: 'erro' });
    expect(monta({ ...entrada, resumo: 'carregando' })).toMatchObject({ naoIdentificadoPct: null, naoIdentificadoMotivo: null });
    expect(monta({ ...entrada, resumo: 'carregando' }).lucroAposAds).not.toBeNull();
  });
  it('período financeiro acima de 366 dias → sem consulta, % null com motivo explícito', () => {
    const a = monta({ ...entrada, resumo: 'periodo_longo' });
    expect(a.naoIdentificadoPct).toBeNull();
    expect(a.naoIdentificadoMotivo).toBe('periodo_longo');
    expect(a.lucroAposAds).not.toBeNull();
  });
  it('grupos acima da conta no período → % null (divergente), nunca negativo', () => {
    const a = monta({ ...entrada, resumo: { custo_conta: 100, dias_conta: DIAS, custo_grupos_com_membro: 101 } });
    expect(a.naoIdentificadoPct).toBeNull();
    expect(a.naoIdentificadoMotivo).toBe('divergente');
  });
  it('período só de hoje (sem dia financeiro): sem %, lucro após Ads indisponível por cobertura', () => {
    const a = monta({ ...entrada, lucroPeriodo: null, resumo: null, diasFinanceiros: { desde: '2026-09-27', ate: '2026-09-26' },
      janela: { desde: '2026-09-27T03:00:00.000Z', ate: '2026-09-28T02:59:59.999Z' } });
    expect(a).toMatchObject({ lucroAposAds: null, motivoSemLucro: 'cobertura', naoIdentificadoPct: null, naoIdentificadoMotivo: null });
  });

  it('fonte do lucro: parcial e estimado seguem com o número e a marca; real também; sem lucro após Ads, sem fonte', () => {
    const f = fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: [dia(11, '2026-09-15', { cost: 7 })] });
    expect(monta({ fonte: f, fonteCusto: 'parcial' })).toMatchObject({ lucroAposAds: 493, fonteLucro: 'parcial' });
    expect(monta({ fonte: f, fonteCusto: 'estimado' })).toMatchObject({ lucroAposAds: 493, fonteLucro: 'estimado' });
    expect(monta({ fonte: f })).toMatchObject({ lucroAposAds: 493, fonteLucro: 'real' });
    expect(monta({ fonte: f, lucroPeriodo: null, fonteCusto: 'sem_custo' })).toMatchObject({ lucroAposAds: null, fonteLucro: null });
  });

  it('lucro do período nulo → lucro após Ads nulo, nunca "−despesa"', () => {
    const a = monta({ lucroPeriodo: null, fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: [dia(11, '2026-09-15', { cost: 7 })] }) });
    expect(a.lucroAposAds).toBeNull();
    expect(a.motivoSemLucro).toBe('sem_lucro');
  });

  it('parcial com linhas já gravadas: nenhuma despesa (totais e custo por grupo nulos), nem lucro após Ads', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] },
      sync: { ...SYNC, carga_inicial_ok: false, cobertura_desde: '2026-09-14' },
      dias: [dia(11, '2026-09-15', { cost: 7, clicks: 2, total_amount: 30 })] }) });
    expect(a.estado).toBe('parcial');
    expect(a.totais).toBeNull();
    expect(a.grupos.map((g) => g.custo)).toEqual([null]);
    expect(a.lucroAposAds).toBeNull();
    expect(a.motivoSemLucro).toBe('cobertura');
    expect([...a.serie, ...a.serieDiaria].every((p) => p.custo === null)).toBe(true);
  });

  it('período não coberto e sem linhas não é "sem_ads"', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, sync: { ...SYNC, cobertura_desde: '2026-09-20' } }) });
    expect(a.totais!.custo).toBe(0);
    expect(a.estado).not.toBe('sem_ads');
  });

  it('denominador zero: CPC, ROAS e ACOS nulos (nunca 0, Infinity ou NaN)', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: diasDe(11, 14, 26) }) });
    expect(a.totais).toMatchObject({ custo: 0, cliques: 0, vendasTotais: 0, cpc: null, roas: null, acos: null });
  });

  it('estados honestos', () => {
    const base = { membros: [[11, 'MLB1']] as [number, string][], codigos: { MLB1: ['A'] } };
    expect(monta({ fonte: fonte({ ...base, sync: null }) }).estado).toBe('sem_coleta');
    const semPerm = monta({ fonte: fonte({ ...base, sync: { ...SYNC, estado: 'sem_permissao', erro: 'ML 403 em advertisers: sem permissão de Publicidade ou conexão recusada' } }) });
    expect(semPerm.estado).toBe('sem_permissao');
    expect(semPerm.erro).toContain('sem permissão de Publicidade');
    expect(monta({ fonte: fonte({ ...base, sync: { ...SYNC, estado: 'sem_advertiser' } }) }).estado).toBe('sem_advertiser');
    const parcial = monta({ fonte: fonte({ ...base, sync: { ...SYNC, carga_inicial_ok: false, cobertura_desde: null } }) });
    expect(parcial.estado).toBe('parcial');
    expect(parcial.motivoSemLucro).toBe('cobertura');
    expect(monta({ fonte: fonte({ ...base, sync: { ...SYNC, ultimo_ok_em: '2026-09-24T14:20:00Z' } }) }).estado).toBe('desatualizado');
    const semGrupo = monta({ fonte: fonte({ membros: [], codigos: {} }) });
    expect(semGrupo).toMatchObject({ estado: 'sem_ads', alcance: 'sku', lucroAposAds: 500 });
    expect(monta({ mlbs: new Map(), fonte: fonte(base) }).alcance).toBe('indisponivel');
    expect(monta({ fonte: 'carregando' }).estado).toBe('carregando');
    expect(monta({ fonte: 'erro' }).estado).toBe('erro');
  });
});
