import { describe, it, expect } from 'vitest';
import { filtrarPublicados, type PublicadoItem, type StatusPublicado } from '../publicados';

const item = (status: StatusPublicado | undefined): PublicadoItem => ({
  familiaId: status ?? 'sem-status', codigoPai: 'P1', gtin: null, titulo: 't',
  fornecedor: null, tipo: null, categoria: null, precoPublicacao: 10,
  descricao: null, mlItemId: 'M1', mlPermalink: null, publicadoEm: null, status,
});

describe('filtrarPublicados — filtro virtual "problema"', () => {
  it('inclui moderado, inativo e pausado; exclui ativo/encerrado/sem status', () => {
    const itens = (['ativo', 'pausado', 'encerrado', 'moderado', 'inativo', 'indisponivel', undefined] as const)
      .map((s) => item(s));
    const filtrados = filtrarPublicados(itens, { status: 'problema' });
    expect(filtrados.map((i) => i.status)).toEqual(['pausado', 'moderado', 'inativo']);
  });
});
