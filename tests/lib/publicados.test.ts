import { describe, it, expect } from 'vitest';
import { filtrarPublicados, dedupePublicados, ordenarPublicados, rotuloTipo } from '../../src/lib/publicados';
import type { PublicadoItem } from '../../src/lib/publicados';

const fixtures: PublicadoItem[] = [
  {
    familiaId: 'f1',
    codigoPai: '00100001',
    titulo: 'Fita Cetim Vermelho 10MT',
    fornecedor: 'Avil',
    tipo: 'fita',
    categoria: null,
    precoPublicacao: 12.9,
    descricao: 'Fita cetim vermelha de alta qualidade.',
    mlItemId: 'MLB111',
    mlPermalink: null,
    publicadoEm: '2026-06-01T00:00:00Z',
    status: 'ativo',
    estoque: 50,
    precoAtual: 12.9,
    motivo: null,
  },
  {
    familiaId: 'f2',
    codigoPai: '00200001',
    titulo: 'Linha Bordado Azul 1500MT',
    fornecedor: 'Coats',
    tipo: 'linha',
    categoria: null,
    precoPublicacao: 8.5,
    descricao: null,
    mlItemId: 'MLB222',
    mlPermalink: 'https://ml.com/MLB222',
    publicadoEm: '2026-06-02T00:00:00Z',
    status: 'pausado',
    estoque: 0,
    precoAtual: 8.5,
    motivo: null,
  },
  {
    familiaId: 'f3',
    codigoPai: '00300001',
    titulo: 'Botao Redondo Preto 12mm',
    fornecedor: 'Avil',
    tipo: 'botao',
    categoria: null,
    precoPublicacao: 4.0,
    descricao: null,
    mlItemId: 'MLB333',
    mlPermalink: 'https://ml.com/MLB333',
    publicadoEm: '2026-06-03T00:00:00Z',
    status: 'ativo',
    estoque: 200,
    precoAtual: 4.0,
    motivo: null,
  },
  {
    familiaId: 'f4',
    codigoPai: '00400001',
    titulo: 'Fita Gorgurão Rosa 5MT',
    fornecedor: 'Coats',
    tipo: 'fita',
    categoria: null,
    precoPublicacao: 6.75,
    descricao: null,
    mlItemId: 'MLB444',
    mlPermalink: null,
    publicadoEm: null,
    status: 'moderado',
    estoque: null,
    precoAtual: null,
    motivo: 'poor_quality_thumbnail',
  },
];

describe('filtrarPublicados', () => {
  it('filtro vazio retorna todos os itens', () => {
    const result = filtrarPublicados(fixtures, {});
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('filtra por fornecedor', () => {
    const result = filtrarPublicados(fixtures, { fornecedor: 'Avil' });
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f3']);
  });

  it('filtra por status', () => {
    const result = filtrarPublicados(fixtures, { status: 'ativo' });
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f3']);
  });

  it('filtra por tipo (rótulo exibido)', () => {
    const result = filtrarPublicados(fixtures, { tipo: 'Fita' });
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f4']);
  });

  it('filtra por busca case-insensitive e parcial no titulo', () => {
    const result = filtrarPublicados(fixtures, { busca: 'bordado' });
    expect(result.map((i) => i.familiaId)).toEqual(['f2']);
  });

  it('busca parcial encontra substring independente do caso', () => {
    const result = filtrarPublicados(fixtures, { busca: 'FITA' });
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f4']);
  });

  it('busca também encontra por código do pai e fornecedor, não só pelo título', () => {
    expect(filtrarPublicados(fixtures, { busca: '00300001' }).map((i) => i.familiaId)).toEqual(['f3']);
    expect(filtrarPublicados(fixtures, { busca: 'coats' }).map((i) => i.familiaId)).toEqual(['f2', 'f4']);
  });

  it('busca encontra por código ou GTIN de uma variação (não só do pai)', () => {
    // Anúncio cujo codigo_pai é 03096955, mas contém a variação 03096963 (GTIN 3000030969633).
    const itens: PublicadoItem[] = [
      { ...fixtures[0], codigoPai: '03096955', identificadores: ['03096963', '3000030969633'] },
      ...fixtures.slice(1),
    ];
    expect(filtrarPublicados(itens, { busca: '03096963' }).map((i) => i.familiaId)).toEqual(['f1']);
    expect(filtrarPublicados(itens, { busca: '3000030969633' }).map((i) => i.familiaId)).toEqual(['f1']);
  });

  it('filtro combinado fornecedor + status restringe mais que cada um isolado', () => {
    // fornecedor='Avil' → f1, f3 (2 itens)
    // status='ativo'   → f1, f3 (2 itens, mas por coincidência iguais)
    // fornecedor='Coats' + status='pausado' → apenas f2
    const resultFornecedor = filtrarPublicados(fixtures, { fornecedor: 'Coats' });
    const resultStatus = filtrarPublicados(fixtures, { status: 'pausado' });
    const resultCombinado = filtrarPublicados(fixtures, { fornecedor: 'Coats', status: 'pausado' });

    expect(resultFornecedor.map((i) => i.familiaId)).toEqual(['f2', 'f4']);
    expect(resultStatus.map((i) => i.familiaId)).toEqual(['f2']);
    expect(resultCombinado.map((i) => i.familiaId)).toEqual(['f2']);
    expect(resultCombinado.length).toBeLessThanOrEqual(resultFornecedor.length);
  });

  it('somenteEncalhados mantém só ativos sem venda no período', () => {
    const itens: PublicadoItem[] = [
      { ...fixtures[0], unidadesVendidas: 0 },   // f1 ativo, 0 venda → encalhado
      { ...fixtures[2], unidadesVendidas: 5 },   // f3 ativo, com venda → fora
      { ...fixtures[1] },                        // f2 pausado → fora (não-ativo)
      { ...fixtures[0], familiaId: 'f1b', unidadesVendidas: null }, // ativo, sem dado de venda → encalhado
    ];
    const r = filtrarPublicados(itens, { somenteEncalhados: true });
    expect(r.map((i) => i.familiaId)).toEqual(['f1', 'f1b']);
  });

  it('somenteEncalhados desligado (ou ausente) não filtra nada', () => {
    expect(filtrarPublicados(fixtures, { somenteEncalhados: false }).map((i) => i.familiaId))
      .toEqual(['f1', 'f2', 'f3', 'f4']);
  });
});

describe('ordenarPublicados', () => {
  it('ord null retorna a mesma lista (sem reordenar nem mutar)', () => {
    const out = ordenarPublicados(fixtures, null);
    expect(out.map((i) => i.familiaId)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('não muta a entrada', () => {
    const antes = fixtures.map((i) => i.familiaId);
    ordenarPublicados(fixtures, { coluna: 'titulo', dir: 'asc' });
    expect(fixtures.map((i) => i.familiaId)).toEqual(antes);
  });

  it('título asc (pt-BR, acento/caixa-insensível)', () => {
    const out = ordenarPublicados(fixtures, { coluna: 'titulo', dir: 'asc' });
    // Botao, Fita Cetim, Fita Gorgurão, Linha
    expect(out.map((i) => i.familiaId)).toEqual(['f3', 'f1', 'f4', 'f2']);
  });

  it('título desc inverte', () => {
    const out = ordenarPublicados(fixtures, { coluna: 'titulo', dir: 'desc' });
    expect(out.map((i) => i.familiaId)).toEqual(['f2', 'f4', 'f1', 'f3']);
  });

  it('preço publicado asc é numérico (não lexicográfico)', () => {
    const out = ordenarPublicados(fixtures, { coluna: 'precoPublicacao', dir: 'asc' });
    // 4.0, 6.75, 8.5, 12.9
    expect(out.map((i) => i.precoPublicacao)).toEqual([4.0, 6.75, 8.5, 12.9]);
  });

  it('estoque asc: nulos por último mesmo em asc', () => {
    const out = ordenarPublicados(fixtures, { coluna: 'estoque', dir: 'asc' });
    // 0 (f2), 50 (f1), 200 (f3), null (f4)
    expect(out.map((i) => i.familiaId)).toEqual(['f2', 'f1', 'f3', 'f4']);
  });

  it('estoque desc: nulos continuam por último', () => {
    const out = ordenarPublicados(fixtures, { coluna: 'estoque', dir: 'desc' });
    // 200, 50, 0, null
    expect(out.map((i) => i.familiaId)).toEqual(['f3', 'f1', 'f2', 'f4']);
  });

  it('status asc segue a severidade (ativo→indisponível)', () => {
    const out = ordenarPublicados(fixtures, { coluna: 'status', dir: 'asc' });
    // ativo(f1), ativo(f3), pausado(f2), moderado(f4)
    expect(out.map((i) => i.status)).toEqual(['ativo', 'ativo', 'pausado', 'moderado']);
  });

  it('publicado em asc (ISO) com nulo por último', () => {
    const out = ordenarPublicados(fixtures, { coluna: 'publicadoEm', dir: 'asc' });
    // 06-01, 06-02, 06-03, null
    expect(out.map((i) => i.familiaId)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });
});

describe('rotuloTipo (categoria real do ML resolvida pela IA)', () => {
  const item = (over: Partial<PublicadoItem>): PublicadoItem => ({
    familiaId: 'x', codigoPai: '001', titulo: 'P', fornecedor: null,
    tipo: null, categoria: null, precoPublicacao: 1, descricao: null,
    mlItemId: 'MLB1', mlPermalink: null, publicadoEm: null, ...over,
  });

  it('usa a categoria real quando presente (alfinete não cai em "Outro")', () => {
    expect(rotuloTipo(item({ categoria: 'Alfinetes de Segurança', tipo: 'outro' })))
      .toBe('Alfinetes de Segurança');
  });

  it('cai no rótulo grosso do tipo quando não há categoria', () => {
    expect(rotuloTipo(item({ categoria: null, tipo: 'fita' }))).toBe('Fita');
    expect(rotuloTipo(item({ categoria: null, tipo: 'outro' }))).toBe('Outro');
  });

  it('mostra "—" quando não há categoria nem tipo', () => {
    expect(rotuloTipo(item({ categoria: null, tipo: null }))).toBe('—');
  });

  it('filtrarPublicados filtra pela categoria real e ordenarPublicados ordena pelo rótulo', () => {
    const itens = [
      item({ familiaId: 'fita', categoria: 'Fitas de Cetim', tipo: 'fita' }),
      item({ familiaId: 'alf', categoria: 'Alfinetes de Segurança', tipo: 'outro' }),
      item({ familiaId: 'sem', categoria: null, tipo: 'outro' }),
    ];
    expect(filtrarPublicados(itens, { tipo: 'Alfinetes de Segurança' }).map((i) => i.familiaId))
      .toEqual(['alf']);
    expect(filtrarPublicados(itens, { tipo: 'Outro' }).map((i) => i.familiaId)).toEqual(['sem']);
    expect(ordenarPublicados(itens, { coluna: 'tipo', dir: 'asc' }).map((i) => i.familiaId))
      .toEqual(['alf', 'fita', 'sem']); // Alfinetes < Fitas < Outro
  });
});

describe('dedupePublicados', () => {
  const base = (over: Partial<PublicadoItem>): PublicadoItem => ({
    familiaId: 'x', codigoPai: '001', titulo: 'Produto', fornecedor: null,
    tipo: 'fita', categoria: null, precoPublicacao: 10, descricao: null, mlItemId: 'MLB1', mlPermalink: null,
    publicadoEm: null, ...over,
  });

  it('colapsa várias linhas do mesmo ml_item_id em uma só', () => {
    const out = dedupePublicados([
      base({ familiaId: 'a' }), base({ familiaId: 'b' }), base({ familiaId: 'c' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].mlItemId).toBe('MLB1');
  });

  it('mantém ml_item_ids distintos separados', () => {
    const out = dedupePublicados([base({ mlItemId: 'MLB1' }), base({ mlItemId: 'MLB2' })]);
    expect(out.map((i) => i.mlItemId).sort()).toEqual(['MLB1', 'MLB2']);
  });

  it('representante: publicado real (publicadoEm) vence o não publicado', () => {
    const out = dedupePublicados([
      base({ familiaId: 'draft', publicadoEm: null }),
      base({ familiaId: 'real', publicadoEm: '2026-06-05T00:00:00Z' }),
    ]);
    expect(out[0].familiaId).toBe('real');
  });

  it('entre publicados, escolhe o mais antigo (publicação original)', () => {
    const out = dedupePublicados([
      base({ familiaId: 'novo', publicadoEm: '2026-06-07T00:00:00Z' }),
      base({ familiaId: 'orig', publicadoEm: '2026-06-04T00:00:00Z' }),
    ]);
    expect(out[0].familiaId).toBe('orig');
  });

  it('preenche fornecedor de qualquer linha do grupo quando o representante não tem', () => {
    const out = dedupePublicados([
      base({ familiaId: 'rep', publicadoEm: '2026-06-04T00:00:00Z', fornecedor: null }),
      base({ familiaId: 'comFornecedor', publicadoEm: null, fornecedor: 'BUFALO' }),
    ]);
    expect(out[0].familiaId).toBe('rep');
    expect(out[0].fornecedor).toBe('BUFALO');
  });
});
