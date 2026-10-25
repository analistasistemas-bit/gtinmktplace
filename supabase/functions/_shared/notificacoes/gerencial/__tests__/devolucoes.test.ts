import { describe, expect, it } from 'vitest';
import { devolucoesConcluidasNoPeriodo, type Devolucao } from '../../../../../../src/lib/devolucoes';
import {
  abertasComPrazoAte, estornadoNoPeriodo, lerDevolucoesDoResumo, type DevolucaoComEstorno,
} from '../devolucoes.ts';
import { janelaDia } from '../janelas.ts';
import { fakeAdmin } from './fake-postgrest.ts';

const ontem = janelaDia('2026-10-23');
const dev = (extra: Partial<DevolucaoComEstorno>): DevolucaoComEstorno => ({
  type: 'returns', status: 'closed', return_status_money: 'refunded', aberto_em: null, fechado_em: null,
  acoes_pendentes: null, valor_estornado: 0, ...extra,
});

describe('estornadoNoPeriodo (paridade com devolucoesConcluidasNoPeriodo)', () => {
  const fixture = [
    dev({ fechado_em: ontem.desde, valor_estornado: 70.5 }), // borda inicial: entra
    dev({ fechado_em: ontem.ate, valor_estornado: 1000 }), // borda final (exclusiva): não entra
    dev({ aberto_em: '2026-10-23T15:00:00.000Z', valor_estornado: 10 }), // sem fechado_em: cai na abertura
    dev({ fechado_em: '2026-10-23T12:00:00+00:00', return_status_money: 'retained', valor_estornado: 500 }),
    dev({ fechado_em: '2026-10-23T12:00:00+00:00', type: 'mediations', valor_estornado: 500 }),
    dev({ fechado_em: '2026-10-22T12:00:00+00:00', aberto_em: '2026-10-23T12:00:00Z', valor_estornado: 500 }),
  ];

  it('limite inicial inclusivo, final exclusivo', () => {
    expect(estornadoNoPeriodo(fixture, ontem)).toBe(80.5);
  });

  it('mesmo valor do front com ate inclusivo = ate − 1 ms', () => {
    const ateInclusivo = new Date(Date.parse(ontem.ate) - 1).toISOString();
    const front = devolucoesConcluidasNoPeriodo(fixture as unknown as Devolucao[], ontem.desde, ateInclusivo);
    expect(front.valor).toBe(estornadoNoPeriodo(fixture, ontem));
  });
});

describe('abertasComPrazoAte', () => {
  it('conta só abertas com algum prazo até o limite', () => {
    const agora = Date.parse('2026-10-24T11:00:00Z');
    const em = (h: number) => new Date(agora + h * 3_600_000).toISOString();
    const acao = (h: number) => [{ action: 'x', due_date: em(h), mandatory: true }];
    const devs = [
      dev({ status: 'opened', acoes_pendentes: acao(24) }),
      dev({ status: 'opened', acoes_pendentes: acao(72) }),
      dev({ status: 'closed', acoes_pendentes: acao(24) }), // fechada não conta (critério de devolucoesAbertas)
      dev({ status: 'opened', acoes_pendentes: [{ action: 'x', due_date: null, mandatory: false }] }),
      dev({ status: 'opened', acoes_pendentes: null }),
    ];
    expect(abertasComPrazoAte(devs, em(48))).toBe(1);
  });
});

describe('lerDevolucoesDoResumo', () => {
  const ORG = 'org-1';
  const base = { org_id: ORG, type: 'returns', return_status_money: null, acoes_pendentes: null, fechado_em: null };

  it('2 consultas filtradas (status e data), 1.200 abertas em 2 páginas, estorno de ml_vendas', async () => {
    const abertas = Array.from({ length: 1200 }, (_, i) => ({
      ...base, id: `a${String(i).padStart(5, '0')}`, status: 'opened', order_id: i + 1, aberto_em: '2026-09-01T12:00:00Z',
    }));
    const admin = fakeAdmin({
      ml_devolucoes: [
        ...abertas,
        // fechada ontem (entra pela data) e uma aberta ontem (sai nas duas leituras: não duplica)
        { ...base, id: 'f1', status: 'closed', return_status_money: 'refunded', order_id: 5001, aberto_em: '2026-10-20T12:00:00Z', fechado_em: '2026-10-23T12:00:00Z' },
        { ...abertas[0], id: 'a-ontem', order_id: 5002, aberto_em: '2026-10-23T13:00:00Z' },
        // antiga fechada: fora das duas leituras
        { ...base, id: 'velha', status: 'closed', order_id: 5003, aberto_em: '2026-01-01T12:00:00Z', fechado_em: '2026-01-02T12:00:00Z' },
        { ...base, id: 'outra-org', org_id: 'org-2', status: 'opened', order_id: 5004, aberto_em: '2026-10-23T12:00:00Z' },
      ],
      ml_vendas: [
        { org_id: ORG, order_id: 5001, estorno: '70.50' },
        { org_id: 'org-2', order_id: 5001, estorno: '999' },
      ],
    });
    const devs = await lerDevolucoesDoResumo(admin, ORG, ontem);

    expect(devs).toHaveLength(1202);
    expect(devs.find((d: any) => d.fechado_em === '2026-10-23T12:00:00Z')?.valor_estornado).toBe(70.5);

    const dev = admin.consultas.filter((c: any) => c.tabela === 'ml_devolucoes');
    const porStatus = dev.filter((c: any) => c.filtros.includes('eq:status'));
    const porData = dev.filter((c: any) => c.filtros.includes('or'));
    expect(porStatus.length + porData.length).toBe(dev.length); // nenhuma leitura sem filtro
    expect(porStatus.map((c: any) => c.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(porData).toHaveLength(1);
    expect(dev.every((c: any) => c.filtros.includes('eq:org_id'))).toBe(true);

    const vendas = admin.consultas.filter((c: any) => c.tabela === 'ml_vendas');
    expect(vendas).toHaveLength(Math.ceil(1202 / 200)); // lotes de 200 order_id
    expect(vendas.every((c: any) => c.filtros.includes('eq:org_id') && c.filtros.includes('in:order_id'))).toBe(true);
  });
});
