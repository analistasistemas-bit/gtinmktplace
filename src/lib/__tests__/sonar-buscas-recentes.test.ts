import { beforeEach, describe, expect, it } from 'vitest';
import { inserirBusca, lerBuscasRecentes, limparBuscasRecentes, registrarBusca, tempoRelativo, type BuscaRecente } from '../sonar-buscas-recentes';

const cliente = { orgId: 'org-a', actorId: 'user-a', supportRequestId: null };
const suporte = { orgId: 'org-a', actorId: 'user-a', supportRequestId: 'support-1' };
const busca = (termo: string, resultado_id: string, em = '2026-08-18T10:00:00.000Z'): BuscaRecente => ({ termo, em, resultado_id });

describe('histórico durável do Sonar', () => {
  beforeEach(() => localStorage.clear());

  it('só registra resultado entregue e deduplica pelo resultado ou termo', () => {
    expect(inserirBusca([], 'cafeteira', '2026-09-06T10:00:00Z', '')).toEqual([]);
    const first = inserirBusca([], 'cafeteira', '2026-09-06T10:00:00Z', 'result-1');
    expect(inserirBusca(first, ' Cafeteira ', '2026-09-06T11:00:00Z', 'result-1')).toHaveLength(1);
    expect(first[0].resultado_id).toBe('result-1');
  });

  it('insere no topo, preserva ordem e limita a dez', () => {
    const first = inserirBusca([busca('tecido oxford', 'r1')], 'renda 70mm', '2026-08-18T11:00:00Z', 'r2');
    expect(first.map((row) => row.termo)).toEqual(['renda 70mm', 'tecido oxford']);
    const dez = Array.from({ length: 10 }, (_, index) => busca(`termo ${index}`, `r${index}`));
    expect(inserirBusca(dez, 'termo novo', '2026-08-18T11:00:00Z', 'r-new')).toHaveLength(10);
    expect(inserirBusca(dez, 'ab', '2026-08-18T11:00:00Z', 'short')).toBe(dez);
  });

  it('isola organização, ator e contexto de suporte', () => {
    registrarBusca(cliente, 'cafeteira', 'result-client');
    registrarBusca(suporte, 'furadeira', 'result-support');
    expect(lerBuscasRecentes(cliente).map((row) => row.resultado_id)).toEqual(['result-client']);
    expect(lerBuscasRecentes(suporte).map((row) => row.resultado_id)).toEqual(['result-support']);
    expect(lerBuscasRecentes({ ...cliente, orgId: 'org-b' })).toEqual([]);
    limparBuscasRecentes(cliente);
    expect(lerBuscasRecentes(cliente)).toEqual([]);
    expect(lerBuscasRecentes(suporte)).toHaveLength(1);
  });
});

describe('tempoRelativo', () => {
  const agora = new Date('2026-08-18T12:00:00.000Z');
  it.each([
    ['2026-08-18T11:59:40.000Z', 'agora há pouco'], ['2026-08-18T11:37:00.000Z', 'há 23 minutos'],
    ['2026-08-18T11:59:00.000Z', 'há 1 minuto'], ['2026-08-17T19:00:00.000Z', 'há cerca de 17 horas'],
    ['2026-08-17T11:30:00.000Z', 'há 1 dia'], ['2026-08-16T11:00:00.000Z', 'há 2 dias'],
  ])('%s → %s', (iso, esperado) => expect(tempoRelativo(iso, agora)).toBe(esperado));
  it('data inválida ou futura vira vazio', () => {
    expect(tempoRelativo('lixo', agora)).toBe('');
    expect(tempoRelativo('2026-08-19T00:00:00.000Z', agora)).toBe('');
  });
});
