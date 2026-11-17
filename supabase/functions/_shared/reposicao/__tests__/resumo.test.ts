import { describe, it, expect } from 'vitest';
import { montarResumo, gravarFoto, deveProcessar } from '../resumo';
import { calcularReposicao, type ResultadoReposicao, type SugestaoSku, type Urgencia } from '../calculo';
import type { PedidoDTO } from '../tipos';

const sku = (codigo: string, urgencia: Urgencia, extra: Partial<SugestaoSku> = {}): SugestaoSku =>
  ({ codigo, codigoPai: 'P1', urgencia, estoqueHoje: 0, v: 1, w: 5, pedir: 3, ...extra } as SugestaoSku);
const catalogo = {
  skus: [
    { codigo: '42', codigoPai: 'P1', cor: 'Marrom Escuro', tamanho: '42' },
    { codigo: '44', codigoPai: 'P1', cor: 'Marrom Escuro', tamanho: '44' },
    { codigo: '46', codigoPai: 'P1', cor: 'Preto', tamanho: '46' },
  ] as any,
  familias: [{ codigoPai: 'P1', nome: 'Calça Sarja' }] as any,
};
const ant = (...p: [string, Urgencia][]) => new Map<string, Urgencia>(p);
const atrasado = { id: 'a', fornecedor: { id: 'f', nome: 'Forn X', cnpj: null }, atrasado: true } as unknown as PedidoDTO;

describe('montarResumo', () => {
  it('piora em_dia → pedir_agora entra', () => {
    const t = montarResumo([sku('42', 'pedir_agora')], ant(['42', 'em_dia']), [], 0, catalogo);
    expect(t).toContain('42');
  });
  it('pedir_agora → pedir_agora não entra', () => {
    expect(montarResumo([sku('42', 'pedir_agora')], ant(['42', 'pedir_agora']), [], 0, catalogo)).toBeNull();
  });
  it('ruptura → pedir_agora (melhorou) não entra', () => {
    expect(montarResumo([sku('42', 'pedir_agora')], ant(['42', 'ruptura']), [], 0, catalogo)).toBeNull();
  });
  it('ausente da foto anterior entra; em_dia hoje nunca entra', () => {
    const t = montarResumo([sku('42', 'vai_faltar'), sku('44', 'em_dia')], ant(), [], 0, catalogo)!;
    expect(t).toContain('42');
    expect(t).not.toContain('44');
  });
  it('dia sem foto: anterior de 2 dias atrás já avisado não reenvia', () => {
    // a foto mais recente (de 2 dias atrás) já tinha 42 em ruptura; hoje continua → null
    expect(montarResumo([sku('42', 'ruptura')], ant(['42', 'ruptura']), [], 0, catalogo)).toBeNull();
  });
  it('nada novo e sem atrasado → null; atrasado sozinho gera texto', () => {
    expect(montarResumo([], ant(), [], 4, catalogo)).toBeNull();
    const t = montarResumo([], ant(), [atrasado], 2, catalogo)!;
    expect(t).toContain('Forn X');
    expect(t).toContain('2');
  });
  it('agrupa por produto e cor, com link para a pior urgência', () => {
    const t = montarResumo(
      [sku('42', 'pedir_agora'), sku('44', 'pedir_agora'), sku('46', 'ruptura')], ant(), [], 0, catalogo,
    )!;
    expect(t).toContain('Calça Sarja · Marrom Escuro: 42, 44');
    expect(t).toContain('Calça Sarja · Preto: 46');
    expect(t).toContain('/#/reposicao?urgencia=ruptura');
  });
});

describe('completar grade (emenda 17/11)', () => {
  it('SKU nunca movimentado nunca entra no resumo, mesmo sem foto anterior', () => {
    const dias = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 10, 16 - 60 + i)).toISOString().slice(0, 10));
    const sk = (codigo: string, nunca: boolean) => ({ codigo, codigoPai: 'P1', cor: 'Preto', tamanho: codigo, estoqueHoje: 0,
      publicadoEm: '2026-01-01', naoRepor: false, ehKit: false, nuncaMovimentado: nunca });
    const r = calcularReposicao({
      hoje: '2026-11-16', prazo: 15, cobertura: 30, skus: [sk('42', false), sk('44', true)], kits: [], pedidosAbertos: [], multiploPorFamilia: {},
      movs: [...dias.map((dia, i) => ({ dia, codigo: '42', vendidas: i % 10 ? 0 : 1, precos: [], estoqueInicio: 3 })),
        ...dias.map((dia) => ({ dia, codigo: '44', vendidas: 0, precos: [], estoqueInicio: 0 }))],
    });
    expect(r.skus.find((s) => s.codigo === '44')!.completarGrade).toBeGreaterThan(0);
    const t = montarResumo(r.skus, ant(), [], 0, catalogo)!;
    expect(t).toContain('42');
    expect(t).not.toContain('44');
  });
});

describe('limite de produtos', () => {
  it('20 produtos → 15 listados, pior urgência primeiro, e linha final', () => {
    const skus = Array.from({ length: 20 }, (_, i) => sku(`S${i}`, i === 19 ? 'ruptura' : 'pedir_agora', { codigoPai: `P${i}` }));
    const t = montarResumo(skus, ant(), [], 0)!;
    expect(t.match(/^• /gm)).toHaveLength(15);
    expect(t).toContain('• P19: S19');
    expect(t).toContain('e mais 5 produtos — veja em /#/reposicao');
  });
});

describe('deveProcessar', () => {
  it('dia == hoje processa; dia passado ignora', () => {
    expect(deveProcessar('2026-11-16', '2026-11-16')).toBe(true);
    expect(deveProcessar('2026-11-15', '2026-11-16')).toBe(false);
  });
});

describe('gravarFoto', () => {
  it('2× no mesmo dia → 1 linha por SKU', async () => {
    const tabela = new Map<string, any>();
    const admin: any = {
      from: (t: string) => ({
        upsert: async (linhas: any[], o: { onConflict: string }) => {
          expect(t).toBe('reposicao_fotos');
          expect(o.onConflict).toBe('org_id,dia,codigo');
          for (const l of linhas) tabela.set(`${l.org_id}|${l.dia}|${l.codigo}`, l);
          return { error: null };
        },
      }),
    };
    const r = { skus: [sku('42', 'ruptura', { estoqueHoje: 0, pedir: 5 }), sku('44', 'em_dia')] } as ResultadoReposicao;
    await gravarFoto(admin, 'o1', '2026-11-16', r);
    await gravarFoto(admin, 'o1', '2026-11-16', r);
    expect(tabela.size).toBe(2);
    expect(tabela.get('o1|2026-11-16|42')).toMatchObject({ codigo_pai: 'P1', urgencia: 'ruptura', sugestao: 5 });
  });
});
