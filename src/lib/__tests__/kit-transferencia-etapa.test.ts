import { describe, expect, it } from 'vitest';
import { etapaTransferencia, quarentenaAte, TOTAL_PASSOS } from '@/lib/kit-transferencia-etapa';

const t = (o: Partial<Parameters<typeof etapaTransferencia>[0]> = {}) =>
  ({ tipo: 'montar', estado: 'ativa', passo: 'pausar', quarentenaAte: null, criacao: false, ...o });

describe('etapaTransferencia', () => {
  it('segue a ordem real dos passos do worker (9 visíveis)', () => {
    expect(TOTAL_PASSOS).toBe(9);
    expect(etapaTransferencia(t({ passo: 'pausar' }), 0)).toMatchObject({ numero: 1, rotulo: 'Pausando os anúncios das peças e do kit' });
    expect(etapaTransferencia(t({ passo: 'conciliar' }), 0)).toMatchObject({ numero: 3, rotulo: 'Conferindo vendas' });
    expect(etapaTransferencia(t({ passo: 'reduzir' }), 0)).toMatchObject({ numero: 5, rotulo: 'Ajustando o estoque das peças' });
    expect(etapaTransferencia(t({ passo: 'aumentar' }), 0)).toMatchObject({ numero: 7, rotulo: 'Colocando o estoque no kit' });
    expect(etapaTransferencia(t({ passo: 'reativar' }), 0)).toMatchObject({ numero: 9, rotulo: 'Reativando os anúncios' });
    expect(etapaTransferencia(t({ passo: 'fim', estado: 'concluida' }), 0)).toMatchObject({ numero: 9, rotulo: 'Concluído' });
  });

  it('criação: o aumento é o CREATE do anúncio do kit; o kit ainda não existe para pausar', () => {
    expect(etapaTransferencia(t({ passo: 'aumentar', criacao: true }), 0).rotulo).toBe('Criando o anúncio do kit no Mercado Livre');
    expect(etapaTransferencia(t({ passo: 'pausar', criacao: true }), 0).rotulo).toBe('Pausando os anúncios das peças');
  });

  it('desmontar inverte: reduz o kit e devolve as peças', () => {
    expect(etapaTransferencia(t({ tipo: 'desmontar', passo: 'reduzir' }), 0).rotulo).toBe('Tirando o estoque do kit');
    expect(etapaTransferencia(t({ tipo: 'desmontar', passo: 'aumentar' }), 0).rotulo).toBe('Devolvendo as peças aos anúncios individuais');
  });

  it('quarentena mostra o tempo que falta', () => {
    const fim = Date.parse('2026-11-08T12:05:00Z');
    const agora = fim - 200_000;
    expect(etapaTransferencia(t({ passo: 'aguardar', quarentenaAte: new Date(fim).toISOString() }), agora).rotulo)
      .toBe('Aguardando 5 min de segurança (faltam 3:20)');
    expect(etapaTransferencia(t({ passo: 'aguardar', quarentenaAte: new Date(fim).toISOString() }), fim + 5000).rotulo)
      .toBe('Aguardando 5 min de segurança');
    expect(etapaTransferencia(t({ passo: 'aguardar' }), agora)).toMatchObject({ numero: 2, rotulo: 'Aguardando 5 min de segurança' });
  });

  it('passo desconhecido não quebra', () => {
    expect(etapaTransferencia(t({ passo: 'novo_passo' }), 0)).toMatchObject({ numero: null, rotulo: 'Em andamento' });
  });
});

describe('quarentenaAte', () => {
  it('conta do último passo 1 gravado; sem nenhum, nulo', () => {
    expect(quarentenaAte(['2026-11-08T12:00:00Z', null, '2026-11-08T12:01:00Z'])).toBe('2026-11-08T12:06:00.000Z');
    expect(quarentenaAte([null, undefined])).toBeNull();
  });
});
