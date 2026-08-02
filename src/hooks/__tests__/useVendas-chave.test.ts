import { afterEach, describe, it, expect, vi } from 'vitest';
import { chaveJanela } from '../useVendas';
import { resolverJanela, janelaAnterior } from '@/lib/metricas';

afterEach(() => {
  vi.useRealTimers();
});

// A chave de cache não pode carregar o instante da resolução. As abas do Faturamento desmontam
// ao trocar (Radix TabsContent), então cada ida e volta resolvia a janela de novo: com o ISO
// cheio na chave, isso virava outra queryKey e refazia o fetch completo da janela inteira,
// além de descartar o cache de que o delta (ADR-0082) depende.
describe('chaveJanela', () => {
  it('mesmo período que termina HOJE, resolvido em instantes diferentes → mesma chave', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z')); // "hoje" = 2026-07-20, bate com o `ate` abaixo
    const a = { desde: '2026-07-01T03:00:00.000Z', ate: '2026-07-20T01:42:22.585Z' };
    const b = { desde: '2026-07-01T03:00:00.000Z', ate: '2026-07-20T01:45:13.306Z' };
    expect(chaveJanela(a)).toEqual(chaveJanela(b));
  });

  it('"hoje": janela "anterior" com hora de corte diferente no mesmo dia PASSADO não compartilha cache (bug real)', () => {
    // Abrir o Dashboard às 06h calcula "anterior" = ontem 00h→06h; reabrir às 18h calcula
    // ontem 00h→18h — mesmo `desde` (ontem 00:00 é sempre o mesmo), `ate` diferente. Truncar o
    // `ate` na data faria as duas colidirem na mesma chave e o refetch em modo delta (só
    // `atualizado_em >= marca`) nunca preencheria o buraco 06h-18h de ontem.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T06:00:00.000Z'));
    const anteriorManha = janelaAnterior(resolverJanela({ tipo: 'hoje' }), { tipo: 'hoje' });

    vi.setSystemTime(new Date('2026-07-20T18:00:00.000Z'));
    const anteriorNoite = janelaAnterior(resolverJanela({ tipo: 'hoje' }), { tipo: 'hoje' });

    expect(anteriorManha.desde).toBe(anteriorNoite.desde); // mesmo "ontem 00:00"
    expect(anteriorManha.ate).not.toBe(anteriorNoite.ate); // corte de hora diferente
    expect(chaveJanela(anteriorManha)).not.toEqual(chaveJanela(anteriorNoite));
  });

  // O furo que a auditoria do Fable pegou: truncar o `desde` na data faria um preset resolvido
  // às 15:00 (desde = 15:00 de N dias atrás) colidir com um range que começa 00:00 do mesmo dia.
  // O range herdaria o cache do preset e o refetch em modo delta nunca traria as vendas da
  // madrugada — KPI financeiro menor que o real, em silêncio.
  it('preset e range que começam no mesmo DIA em horas diferentes NÃO compartilham cache', () => {
    const preset7 = { desde: '2026-07-12T18:00:00.000Z', ate: '2026-07-19T18:00:00.000Z' };
    const rangeCustom = { desde: '2026-07-12T03:00:00.000Z', ate: '2026-07-19T02:59:59.999Z' };
    expect(chaveJanela(preset7)).not.toEqual(chaveJanela(rangeCustom));
  });

  it('períodos com datas distintas continuam em caches distintos', () => {
    const mesAtual = { desde: '2026-07-01T03:00:00.000Z', ate: '2026-07-20T12:00:00.000Z' };
    const hoje = { desde: '2026-07-20T03:00:00.000Z', ate: '2026-07-20T12:00:00.000Z' };
    expect(chaveJanela(mesAtual)).not.toEqual(chaveJanela(hoje));
  });

  it("duas resoluções reais de 'mes_atual' colapsam na mesma chave", () => {
    const p = { tipo: 'mes_atual' } as const;
    expect(chaveJanela(resolverJanela(p))).toEqual(chaveJanela(resolverJanela(p)));
  });
});
