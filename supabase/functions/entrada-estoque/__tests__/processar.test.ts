import { describe, it, expect, vi } from 'vitest';
import { processarEntrada, type DepsEntrada } from '../processar';
import { validarEntrada, refDoItem } from '../validar';

function deps(over: Partial<DepsEntrada> & { erroPorCodigo?: Record<string, string> } = {}) {
  const chamadas: Array<Record<string, unknown>> = [];
  const jobs: Array<Record<string, unknown>> = [];
  const base: DepsEntrada = {
    rpc: (_nome, args) => {
      chamadas.push(args);
      const erro = over.erroPorCodigo?.[String(args.p_codigo)];
      return Promise.resolve(erro ? { data: null, error: { message: erro } } : { data: 40, error: null });
    },
    lerMovimento: () => Promise.resolve({ codigo_pai: 'P001', estoque_resultante: 40 }),
    enfileirar: (job) => { jobs.push(job); return Promise.resolve('msg'); },
    ...over,
  };
  return { deps: base, chamadas, jobs };
}

const P = { orgId: 'org-1', userId: 'u-1', documento: null, observacao: null, ref: 'r-1' };

describe('validarEntrada', () => {
  it('aceita o formato antigo de uma cor', () => {
    const r = validarEntrada({ codigo: 'A1', quantidade: 5, custo: 10 });
    expect(r).toEqual({ ok: true, unico: true, itens: [{ codigo: 'A1', quantidade: 5, custo: 10 }] });
  });

  it('aceita a lista e mantém custo null (que preserva o custo atual do SKU)', () => {
    const r = validarEntrada({ itens: [{ codigo: 'A1', quantidade: 5 }, { codigo: 'A2', quantidade: 2 }] });
    expect(r).toEqual({
      ok: true, unico: false,
      itens: [{ codigo: 'A1', quantidade: 5, custo: null }, { codigo: 'A2', quantidade: 2, custo: null }],
    });
  });

  it('recusa SKU repetido: as duas ocorrências gerariam a MESMA ref e a 2ª viraria duplicata', () => {
    const r = validarEntrada({ itens: [{ codigo: 'A1', quantidade: 5 }, { codigo: 'A1', quantidade: 3 }] });
    expect(r).toEqual({ ok: false, erro: 'SKU repetido na lista: A1.' });
  });

  it('recusa quantidade não positiva e custo zero', () => {
    expect(validarEntrada({ itens: [{ codigo: 'A1', quantidade: 0 }] }).ok).toBe(false);
    expect(validarEntrada({ itens: [{ codigo: 'A1', quantidade: 5, custo: 0 }] }).ok).toBe(false);
  });
});

describe('refDoItem', () => {
  // Mudar o formato da ref de UMA cor faria o retry de uma submissão antiga somar o saldo de novo.
  it('uma cor mantém a ref histórica; a lista deriva uma por SKU', () => {
    expect(refDoItem('r-1', 'A1', true)).toBe('entrada:r-1');
    expect(refDoItem('r-1', 'A1', false)).toBe('entrada:r-1:A1');
    expect(refDoItem('r-1', 'A2', false)).toBe('entrada:r-1:A2');
  });
});

describe('processarEntrada', () => {
  it('uma RPC por item, cada uma com sua própria referência', async () => {
    const { deps: d, chamadas } = deps();
    await processarEntrada(d, {
      ...P, unico: false,
      itens: [{ codigo: 'A1', quantidade: 40, custo: 32.84 }, { codigo: 'A2', quantidade: 25, custo: 32.84 }],
    });
    expect(chamadas.map((c) => c.p_ref)).toEqual(['entrada:r-1:A1', 'entrada:r-1:A2']);
    expect(chamadas.map((c) => c.p_qtd)).toEqual([40, 25]);
    expect(chamadas.map((c) => c.p_custo)).toEqual([32.84, 32.84]);
  });

  it('UM push por produto tocado, com reativar: true e sem recorte por SKU', async () => {
    const { deps: d, jobs } = deps();
    await processarEntrada(d, {
      ...P, unico: false,
      itens: [{ codigo: 'A1', quantidade: 1, custo: null }, { codigo: 'A2', quantidade: 1, custo: null }],
    });
    // Entrada é reposição (ADR-0111) e o push do produto INTEIRO é o que reconverge o anúncio
    // com o saldo do app — `skus` é do outro caminho (cor nova pelo outbox).
    expect(jobs).toEqual([{ org_id: 'org-1', codigo_pai: 'P001', canal_origem: null, reativar: true }]);
  });

  it('item com erro não derruba os outros e vem identificado no resultado', async () => {
    const { deps: d } = deps({ erroPorCodigo: { A2: 'SKU não encontrado' } });
    const r = await processarEntrada(d, {
      ...P, unico: false,
      itens: [{ codigo: 'A1', quantidade: 1, custo: null }, { codigo: 'A2', quantidade: 1, custo: null }],
    });
    expect(r.resultados).toEqual([
      { codigo: 'A1', estoque: 40, duplicada: false },
      { codigo: 'A2', estoque: null, duplicada: false, erro: 'SKU não encontrado' },
    ]);
  });

  it('tudo duplicado ainda enfileira o push (a 1ª tentativa pode ter morrido antes de enfileirar)', async () => {
    const { deps: d, jobs } = deps({ rpc: () => Promise.resolve({ data: null, error: null }) });
    const r = await processarEntrada(d, { ...P, unico: false, itens: [{ codigo: 'A1', quantidade: 1, custo: null }] });
    expect(r.resultados[0]!.duplicada).toBe(true);
    expect(r.resultados[0]!.estoque).toBe(40);
    expect(jobs).toHaveLength(1);
  });

  it('falha ao enfileirar não perde a entrada: pushOk=false, resultados intactos', async () => {
    const erro = vi.fn(() => Promise.reject(new Error('qstash fora')));
    const { deps: d } = deps({ enfileirar: erro as unknown as DepsEntrada['enfileirar'] });
    const r = await processarEntrada(d, { ...P, unico: false, itens: [{ codigo: 'A1', quantidade: 1, custo: null }] });
    expect(r.pushOk).toBe(false);
    expect(r.resultados[0]!.estoque).toBe(40);
  });
});
