import { describe, it, expect } from 'vitest';
import { resolverConfigGrupo, agregarAtacadoStatus } from '../config-grupo';

const fam = (over = {}) => ({ atacado: null, ...over });
const v = (codigo: string, over = {}) => ({ codigo, atacado: null, ...over });
const faixas = [{ min_unidades: 5, desconto_pct: 5 }];

describe('resolverConfigGrupo', () => {
  it('uniforme: herda o família-level intacto (caracterização — comportamento de hoje)', () => {
    const cfg = resolverConfigGrupo(fam({ atacado: faixas }), [v('A'), v('B')], false);
    expect(cfg).toEqual({ faixasAtacado: faixas });
  });

  it('uniforme sem nada ativo: tudo desligado', () => {
    expect(resolverConfigGrupo(fam(), [v('A')], false)).toEqual({ faixasAtacado: [] });
  });

  it('divergente com config explícita e idêntica no grupo: usa a do grupo', () => {
    const cfg = resolverConfigGrupo(
      fam(),
      [v('A', { atacado: faixas }), v('B', { atacado: faixas })],
      true,
    );
    expect(cfg).toEqual({ faixasAtacado: faixas });
  });

  // Guard isolado (pós-remoção do desconto visual, ADR-0162): atacado ativo sozinho, sem
  // nenhum resquício de desconto nas fixtures, ainda tem que disparar o LOUD exatamente como
  // antes — prova que a separação do guard combinado não quebrou a metade que sobrou.
  it('atacado ativo + variação sem override → LOUD 400 dispara sozinho', () => {
    try {
      resolverConfigGrupo(fam({ atacado: faixas }), [v('A')], true);
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect((e as Error & { status?: number }).status).toBe(400);
      expect((e as Error).message).toContain('faixa');
    }
  });

  it('divergente + família sem nada ativo + sem explícito → desligado, SEM LOUD (nada financeiro em jogo)', () => {
    expect(resolverConfigGrupo(fam(), [v('A'), v('B')], true)).toEqual({ faixasAtacado: [] });
  });

  it('atacado explícito [] = explicitamente sem atacado → não é pendência', () => {
    const cfg = resolverConfigGrupo(fam({ atacado: faixas }), [v('A', { atacado: [] })], true);
    expect(cfg.faixasAtacado).toEqual([]);
  });

  it('config divergente DENTRO do grupo → LOUD 400 (repreçar não pode misturar configs)', () => {
    expect(() => resolverConfigGrupo(
      fam(),
      [
        v('A', { atacado: [{ min_unidades: 5, desconto_pct: 10 }] }),
        v('B', { atacado: [] }),
      ],
      true,
    )).toThrowError(/divergente/i);
  });
});

describe('agregarAtacadoStatus', () => {
  it('algum erro → erro com a mensagem', () => {
    expect(agregarAtacadoStatus([
      { status: 'aplicado', erro: null }, { status: 'erro', erro: 'PxQ (400): x' },
    ])).toEqual({ atacado_status: 'erro', atacado_erro: 'PxQ (400): x' });
  });
  it('só aplicado → aplicado', () => {
    expect(agregarAtacadoStatus([{ status: 'aplicado', erro: null }, { status: null, erro: null }]))
      .toEqual({ atacado_status: 'aplicado', atacado_erro: null });
  });
  it('nenhum atacado → null', () => {
    expect(agregarAtacadoStatus([{ status: null, erro: null }]))
      .toEqual({ atacado_status: null, atacado_erro: null });
  });
});
