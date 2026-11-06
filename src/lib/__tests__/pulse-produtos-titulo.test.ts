// Ficha recusada pela trava de equivalência não é o nosso produto: medido na Hairfly (06/11), o
// Creme Alisante 500g aparecia no Radar como "Kit De Tratamento Cadiveu", o nome da ficha que o ML
// devolveu pelo EAN. Nessas linhas o nome vem do nosso anúncio (ADR-0119 mantém a linha no Radar).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({
  produtos: [] as unknown[],
  familias: { data: [] as unknown[], error: null as unknown },
  codigosPedidos: [] as string[][],
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const resultado = tabela === 'pulse_produtos' ? { data: banco.produtos, error: null } : banco.familias;
      // deno-lint-ignore no-explicit-any
      const api: any = {
        select: () => api, neq: () => api, not: () => api, order: () => api,
        in: (_coluna: string, codigos: string[]) => { banco.codigosPedidos.push(codigos); return api; },
        then: (ok: (x: unknown) => unknown) => ok(resultado),
      };
      return api;
    },
  },
}));
vi.mock('../queries', () => ({ fetchAliquotas: vi.fn() }));

import { fetchPulseProdutos } from '../pulse';

const produto = (over: Record<string, unknown>) => ({
  id: 'p', catalog_product_id: 'MLB1', codigo_pai: '001', titulo: 'Kit Cadiveu',
  catalogo_status: 'ficha_divergente', meu_preco: null, comissao_pct: null, comissao_fixa: null, comissao_preco: null,
  ...over,
});

beforeEach(() => {
  banco.produtos = [];
  banco.familias = { data: [], error: null };
  banco.codigosPedidos = [];
});

describe('fetchPulseProdutos: nome da linha com ficha recusada', () => {
  it('ficha_divergente mostra o nome do nosso anúncio', async () => {
    banco.produtos = [produto({})];
    banco.familias.data = [{ codigo_pai: '001', titulo_ml: 'Creme Alisante 500g' }];
    expect((await fetchPulseProdutos())[0].titulo).toBe('Creme Alisante 500g');
  });

  it('com várias famílias do mesmo código vence a primeira, a mais recente', async () => {
    banco.produtos = [produto({})];
    banco.familias.data = [
      { codigo_pai: '001', titulo_ml: 'Título novo' },
      { codigo_pai: '001', titulo_ml: 'Título antigo' },
    ];
    expect((await fetchPulseProdutos())[0].titulo).toBe('Título novo');
  });

  it('ficha vinculada mantém o nome da ficha e não consulta famílias', async () => {
    banco.produtos = [produto({ catalogo_status: 'vinculado', titulo: 'Nome da ficha' })];
    expect((await fetchPulseProdutos())[0].titulo).toBe('Nome da ficha');
    expect(banco.codigosPedidos).toEqual([]);
  });

  it('falha ao ler o nome não derruba o Radar', async () => {
    banco.produtos = [produto({})];
    banco.familias = { data: null as unknown as unknown[], error: new Error('rede') };
    expect((await fetchPulseProdutos())[0].titulo).toBe('Kit Cadiveu');
  });
});
