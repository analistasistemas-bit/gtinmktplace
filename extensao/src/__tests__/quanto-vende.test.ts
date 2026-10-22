import { describe, expect, it } from 'vitest';
import { pisoDosVendidos, quantoVende, startTimeDoHtml, vendidosDoHtml } from '../compartilhado/quanto-vende';

const AGORA = new Date('2026-10-22T12:00:00Z');

describe('pisoDosVendidos', () => {
  it.each([
    ['+1000 vendidos', 1000],
    ['+50 vendidos', 50],
    ['1 vendido', 1],
    ['2 vendidos', 2],
    ['+5mil vendidos', 5000],
    ['+5 mil vendidos', 5000],
    ['+2,5 mil vendidos', 2500],
    ['+10.000 vendidos', 10000],
  ])('%s → %i', (texto, piso) => expect(pisoDosVendidos(texto)).toBe(piso));

  it('sem texto ou ilegível → null', () => {
    expect(pisoDosVendidos(null)).toBeNull();
    expect(pisoDosVendidos('Novo')).toBeNull();
  });
});

describe('quantoVende (do anúncio)', () => {
  it('faixa, idade com semáforo e mínimo por mês e por dia (piso ÷ idade, para baixo)', () => {
    expect(quantoVende({ vendidosTexto: '+1000 vendidos', criadoEm: '2026-04-25T12:00:00Z' }, AGORA))
      .toEqual({ piso: 1000, criadoEm: '2026-04-25T12:00:00Z', dias: 180, semaforo: 'verde', minimoPorMes: 169, minimoPorDia: 5.5 });
  });

  it('semáforo: 181 dias amarelo, 366 vermelho', () => {
    expect(quantoVende({ vendidosTexto: null, criadoEm: '2026-04-24T12:00:00Z' }, AGORA).semaforo).toBe('amarelo');
    expect(quantoVende({ vendidosTexto: null, criadoEm: '2025-10-21T12:00:00Z' }, AGORA).semaforo).toBe('vermelho');
  });

  it('menos de 1 mês conta como 1 mês e menos de 1 dia como 1 dia (mínimo nunca maior que o piso)', () => {
    const q = quantoVende({ vendidosTexto: '2 vendidos', criadoEm: '2026-10-07T23:50:26Z' }, AGORA);
    expect(q.minimoPorMes).toBe(2);
    expect(q.minimoPorDia).toBe(0.1);
    expect(quantoVende({ vendidosTexto: '+5 vendidos', criadoEm: '2026-10-22T08:00:00Z' }, AGORA).minimoPorDia).toBe(5);
  });

  it('sem data: só a faixa, sem idade nem mínimos (nunca presumido)', () => {
    expect(quantoVende({ vendidosTexto: '+1000 vendidos', criadoEm: null }, AGORA))
      .toEqual({ piso: 1000, criadoEm: null, dias: null, semaforo: null, minimoPorMes: null, minimoPorDia: null });
  });

  it('data inválida ou no futuro → sem data', () => {
    expect(quantoVende({ vendidosTexto: null, criadoEm: 'xx' }, AGORA).criadoEm).toBeNull();
    expect(quantoVende({ vendidosTexto: null, criadoEm: '2027-01-01T00:00:00Z' }, AGORA).criadoEm).toBeNull();
  });
});

describe('startTimeDoHtml', () => {
  it('lê o startTime do gtm_event do anúncio pedido', () => {
    const html = '..."gtm_event":{"pageId":"VIP","itemId":"MLB4982690837","sellerId":1,"startTime":"2026-08-02T13:30:56.845Z","stopTime":"2046-07-28T04:00:00Z"}...';
    expect(startTimeDoHtml(html, 'MLB4982690837')).toBe('2026-08-02T13:30:56.845Z');
  });

  it('Codex: evento do item sem startTime não pega a data do evento seguinte', () => {
    const html = '"gtm_event":{"itemId":"MLB1","x":{"y":1}} "gtm_event":{"itemId":"MLB2","startTime":"2026-08-02T13:30:56Z"}';
    expect(startTimeDoHtml(html, 'MLB1')).toBeNull();
  });

  it('chave "}" dentro de string não fecha o evento antes da hora', () => {
    expect(startTimeDoHtml('"gtm_event":{"itemId":"MLB1","t":"a}b","startTime":"2026-08-02T13:30:56Z"}', 'MLB1')).toBe('2026-08-02T13:30:56Z');
  });

  it('gtm_event de outro item ou ausente → null', () => {
    expect(startTimeDoHtml('"gtm_event":{"itemId":"MLB1","startTime":"2026-08-02T13:30:56Z"}', 'MLB2')).toBeNull();
    expect(startTimeDoHtml('<html>captcha</html>', 'MLB2')).toBeNull();
  });
});

describe('vendidosDoHtml (faixa do próprio anúncio na página produto.mercadolivre)', () => {
  it('lê o "N vendidos" do subtitle_label, só se o HTML é do anúncio pedido', () => {
    const html = '"subtitle_label":{"text":"Novo  |  2 vendidos","color":"X"} "gtm_event":{"itemId":"MLB7765568724","startTime":"2026-10-07T23:50:26Z"}';
    expect(vendidosDoHtml(html, 'MLB7765568724')).toBe('2 vendidos');
    expect(vendidosDoHtml(html, 'MLB1')).toBeNull();
  });

  it('sem subtitle com vendidos → null', () => {
    expect(vendidosDoHtml('"subtitle_label":{"text":"Novo"} "gtm_event":{"itemId":"MLB1"}', 'MLB1')).toBeNull();
  });
});
