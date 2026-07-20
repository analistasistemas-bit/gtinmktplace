import { describe, it, expect } from 'vitest';
import { familiaResumoFromRow } from '../queries';
import type { FamiliaStatus } from '../tipos-dominio';

const baseRow: {
  id: string; codigo_pai: string; titulo_ml: string | null; nome_pai: string;
  status: FamiliaStatus; erro_mensagem: string | null; ml_permalink: string | null;
} = {
  id: 'fam-1',
  codigo_pai: 'P1',
  titulo_ml: 'Título ML',
  nome_pai: 'Nome Pai',
  status: 'pronto',
  erro_mensagem: null,
  ml_permalink: 'https://ml/anuncio',
};

describe('familiaResumoFromRow', () => {
  it('mapeia campos 1:1', () => {
    const r = familiaResumoFromRow(baseRow, []);
    expect(r).toMatchObject({
      id: 'fam-1',
      codigoPai: 'P1',
      status: 'pronto',
      erroMensagem: null,
      mlPermalink: 'https://ml/anuncio',
    });
  });

  it('titulo usa titulo_ml quando presente', () => {
    const r = familiaResumoFromRow(baseRow, []);
    expect(r.titulo).toBe('Título ML');
  });

  it('titulo cai para nome_pai quando titulo_ml é null', () => {
    const r = familiaResumoFromRow({ ...baseRow, titulo_ml: null }, []);
    expect(r.titulo).toBe('Nome Pai');
  });

  it('anuncios: ordena por particao crescente e não muta a entrada', () => {
    const entrada = [
      { codigo_pai: 'P1', particao: 2, permalink: 'p2', titulo: 't2' },
      { codigo_pai: 'P1', particao: 0, permalink: 'p0', titulo: 't0' },
      { codigo_pai: 'P1', particao: 1, permalink: 'p1', titulo: 't1' },
    ];
    const entradaCopia = [...entrada];
    const r = familiaResumoFromRow(baseRow, entrada);
    expect(r.anuncios.map((a) => a.particao)).toEqual([0, 1, 2]);
    expect(entrada).toEqual(entradaCopia);
  });

  it('anuncios vazio → []', () => {
    const r = familiaResumoFromRow(baseRow, []);
    expect(r.anuncios).toEqual([]);
  });
});
