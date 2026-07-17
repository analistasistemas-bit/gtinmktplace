import { describe, it, expect } from 'vitest';
import { resolverConfigGrupo, agregarAtacadoStatus } from '../config-grupo';

const fam = (over = {}) => ({ exibir_com_desconto: false, desconto_pct: null, atacado: null, ...over });
const v = (codigo: string, over = {}) =>
  ({ codigo, exibir_com_desconto: null, desconto_pct: null, atacado: null, ...over });
const faixas = [{ min_unidades: 5, desconto_pct: 5 }];

describe('resolverConfigGrupo', () => {
  it('uniforme: herda o família-level intacto (caracterização — comportamento de hoje)', () => {
    const cfg = resolverConfigGrupo(
      fam({ exibir_com_desconto: true, desconto_pct: '20', atacado: faixas }),
      [v('A'), v('B')],
      false,
    );
    expect(cfg).toEqual({ exibirComDesconto: true, descontoPct: 20, faixasAtacado: faixas });
  });

  it('uniforme sem nada ativo: tudo desligado', () => {
    expect(resolverConfigGrupo(fam(), [v('A')], false))
      .toEqual({ exibirComDesconto: false, descontoPct: null, faixasAtacado: [] });
  });

  it('divergente com config explícita e idêntica no grupo: usa a do grupo', () => {
    const cfg = resolverConfigGrupo(
      fam({ exibir_com_desconto: true, desconto_pct: 15 }),
      [
        v('A', { exibir_com_desconto: true, desconto_pct: 10, atacado: faixas }),
        v('B', { exibir_com_desconto: true, desconto_pct: 10, atacado: faixas }),
      ],
      true,
    );
    expect(cfg).toEqual({ exibirComDesconto: true, descontoPct: 10, faixasAtacado: faixas });
  });

  it('divergente + desconto família ativo + variação sem confirmação explícita → LOUD 400', () => {
    try {
      resolverConfigGrupo(
        fam({ exibir_com_desconto: true, desconto_pct: 15 }),
        [v('A', { exibir_com_desconto: true, desconto_pct: 15 }), v('B')],
        true,
      );
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect((e as Error & { status?: number }).status).toBe(400);
      expect((e as Error).message).toContain('faixa');
    }
  });

  it('divergente + atacado família ativo + variação sem atacado explícito → LOUD 400', () => {
    expect(() => resolverConfigGrupo(fam({ atacado: faixas }), [v('A')], true))
      .toThrowError(/faixa/i);
  });

  it('divergente + família sem nada ativo + sem explícito → desligado, SEM LOUD (nada financeiro em jogo)', () => {
    expect(resolverConfigGrupo(fam(), [v('A'), v('B')], true))
      .toEqual({ exibirComDesconto: false, descontoPct: null, faixasAtacado: [] });
  });

  it('atacado explícito [] = explicitamente sem atacado → não é pendência', () => {
    const cfg = resolverConfigGrupo(
      fam({ atacado: faixas }),
      [v('A', { exibir_com_desconto: false, atacado: [] })],
      true,
    );
    expect(cfg.faixasAtacado).toEqual([]);
  });

  it('config divergente DENTRO do grupo → LOUD 400 (repreçar não pode misturar configs)', () => {
    expect(() => resolverConfigGrupo(
      fam(),
      [
        v('A', { exibir_com_desconto: true, desconto_pct: 10, atacado: [] }),
        v('B', { exibir_com_desconto: false, desconto_pct: null, atacado: [] }),
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
