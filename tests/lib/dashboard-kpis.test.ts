import { describe, it, expect } from 'vitest';
import { calcularKpisDashboard } from '@/lib/dashboard-kpis';
import type { Lote } from '@/lib/tipos-dominio';
import type { PublicadoItem } from '@/lib/publicados';
import type { StatusPublicadoItem } from '@/lib/queries';

function lote(over: Partial<Lote>): Lote {
  return {
    id: 'l', numero: 1, criadoEm: '2026-06-09T00:00:00.000Z', status: 'concluido',
    totalFamilias: 0, totalPublicadas: 0, totalErros: 0,
    anomalias: { codigos_duplicados: [], filhos_orfaos: [], familias_sem_filho: [] },
    ...over,
  };
}
function pub(id: string, qtdVariacoes?: number): PublicadoItem {
  return {
    familiaId: id, codigoPai: id, titulo: id, fornecedor: null, tipo: null,
    precoPublicacao: 0, descricao: null, mlItemId: 'MLB' + id, mlPermalink: null, publicadoEm: null,
    qtdVariacoes,
  };
}
function st(status: StatusPublicadoItem['status']): StatusPublicadoItem {
  return { ml_item_id: 'x', status, motivo: null, estoque: null, preco: null };
}

describe('calcularKpisDashboard', () => {
  it('tudo zero para entradas vazias', () => {
    expect(calcularKpisDashboard([], [], [])).toEqual({
      publicados: 0, ativos: 0, comProblema: 0, erros: 0, aRevisar: 0, variacoesPublicadas: 0,
    });
  });

  it('publicados = nº de anúncios (length de publicados)', () => {
    const r = calcularKpisDashboard([], [pub('a'), pub('b'), pub('c')], []);
    expect(r.publicados).toBe(3);
  });

  it('ativos conta apenas status "ativo"', () => {
    const r = calcularKpisDashboard([], [], [st('ativo'), st('ativo'), st('pausado')]);
    expect(r.ativos).toBe(2);
  });

  it('comProblema conta moderado + inativo + pausado', () => {
    const r = calcularKpisDashboard([], [], [st('moderado'), st('inativo'), st('pausado')]);
    expect(r.comProblema).toBe(3);
  });

  it('comProblema NÃO conta ativo, encerrado nem indisponivel', () => {
    const r = calcularKpisDashboard([], [], [st('ativo'), st('encerrado'), st('indisponivel')]);
    expect(r.comProblema).toBe(0);
  });

  it('erros = soma de totalErros dos lotes', () => {
    const r = calcularKpisDashboard([lote({ totalErros: 2 }), lote({ totalErros: 3 })], [], []);
    expect(r.erros).toBe(5);
  });

  it('aRevisar = nº de lotes em status "revisao"', () => {
    const r = calcularKpisDashboard(
      [lote({ status: 'revisao' }), lote({ status: 'concluido' }), lote({ status: 'revisao' })],
      [], [],
    );
    expect(r.aRevisar).toBe(2);
  });

  it('variacoesPublicadas = soma de qtdVariacoes dos anúncios (0 quando ausente)', () => {
    const r = calcularKpisDashboard([], [pub('a', 5), pub('b', 3), pub('c')], []);
    expect(r.variacoesPublicadas).toBe(8);
  });
});
