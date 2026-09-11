// Filtro "sem vínculo de catálogo" (ADR-0021, adendo 2026-09-11). O botão ↻ já existia na linha,
// mas nada dizia ONDE ele estava: achá-lo exigia varrer a lista inteira. Foi assim que o Centrum
// ficou um mês em `sem_produto` com o catálogo já ativo e vendendo no ML, sem ninguém notar.
import { describe, it, expect } from 'vitest';
import { filtrarPublicados, type PublicadoItem } from '../publicados';
import { estadoParaParams, paramsParaEstado } from '../publicados-url';

const base = (over: Partial<PublicadoItem> = {}): PublicadoItem => ({
  familiaId: 'f1', codigoPai: 'P1', gtin: null, titulo: 't', fornecedor: null, tipo: null,
  categoria: null, precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null,
  mlItemId: 'M1', mlPermalink: null, publicadoEm: null, ...over,
});

describe('filtro "somenteSemCatalogo"', () => {
  it('deixa passar só quem tem catálogo retentável (= quem mostra o botão ↻)', () => {
    const itens = [
      base({ mlItemId: 'M1', status: 'ativo' }),
      base({ mlItemId: 'M2', catalogRetentavel: true, status: 'ativo' }),
      base({ mlItemId: 'M3', catalogRetentavel: false, status: 'ativo' }),
    ];
    expect(filtrarPublicados(itens, { somenteSemCatalogo: true }).map((i) => i.mlItemId)).toEqual(['M2']);
  });

  it('sem o filtro, a lista não muda — o chip é atalho, não esconde nada por padrão', () => {
    const itens = [base({ mlItemId: 'M1' }), base({ mlItemId: 'M2', catalogRetentavel: true })];
    expect(filtrarPublicados(itens, {}).map((i) => i.mlItemId)).toEqual(['M1', 'M2']);
  });

  it('combina com os outros filtros em vez de sobrescrevê-los', () => {
    const itens = [
      base({ mlItemId: 'M1', catalogRetentavel: true, fornecedor: 'ACME' }),
      base({ mlItemId: 'M2', catalogRetentavel: true, fornecedor: 'OUTRO' }),
    ];
    expect(filtrarPublicados(itens, { somenteSemCatalogo: true, fornecedor: 'ACME' }).map((i) => i.mlItemId))
      .toEqual(['M1']);
  });

  it('convive com "somenteIncompletos": os dois ligados exigem as DUAS condições', () => {
    const itens = [
      base({ mlItemId: 'M1', catalogRetentavel: true }),
      base({ mlItemId: 'M2', publicacaoIncompleta: true }),
      base({ mlItemId: 'M3', catalogRetentavel: true, publicacaoIncompleta: true }),
    ];
    expect(filtrarPublicados(itens, { somenteSemCatalogo: true, somenteIncompletos: true }).map((i) => i.mlItemId))
      .toEqual(['M3']);
  });
});

describe('filtro na URL', () => {
  it('ida e volta preserva o filtro (o link compartilhado continua filtrando)', () => {
    const p = estadoParaParams({ filtro: { somenteSemCatalogo: true }, ord: null, pagina: 1, tamanho: 25 });
    expect(p.get('semcatalogo')).toBe('1');
    expect(paramsParaEstado(p).filtro.somenteSemCatalogo).toBe(true);
  });

  it('ausente na URL não liga o filtro', () => {
    expect(paramsParaEstado(new URLSearchParams()).filtro.somenteSemCatalogo).toBeUndefined();
  });
});
