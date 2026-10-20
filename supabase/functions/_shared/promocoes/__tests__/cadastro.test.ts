import { describe, expect, it } from 'vitest';
import { montarCadastro, resolverCor, resolverPack, type LinhaVariacao } from '../cadastro.ts';

const v = (o: Partial<LinhaVariacao> & { id: string }): LinhaVariacao => ({
  custo: 10, preco: 18, cor: 'Azul', codigo: null, gtin: null, ml_variation_id: null,
  peso_gramas: 200, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
  familias: { ml_item_id: 'MLB1', origem: 'nacional' }, ...o,
});

describe('resolverCor', () => {
  it('item filho de User Products casa pelo anuncios_externos_itens, mesmo sem SKU (ADR-0105)', () => {
    const c = montarCadastro([v({ id: 'a', cor: 'Rosa' })], [{ item_externo_id: 'MLB900', variacao_id: 'a' }]);
    expect(resolverCor(c, { item_id: 'MLB900', variation_id: null, sku: null, gtin: null })?.cor).toBe('Rosa');
  });

  it('Legacy casa por ml_variation_id', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '555', cor: 'Verde' })], []);
    expect(resolverCor(c, { item_id: 'MLBx', variation_id: 555, sku: null, gtin: null })?.cor).toBe('Verde');
  });

  it('cai para GTIN e depois código/SKU, ignorando zeros à esquerda', () => {
    const c = montarCadastro([v({ id: 'a', codigo: '00123', gtin: '0789', familias: { ml_item_id: null, origem: 'nacional' } })], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '123', gtin: null })?.variacao_id).toBe('a');
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: null, gtin: '789' })?.variacao_id).toBe('a');
  });

  it('ml_item_id só resolve anúncio de variação única', () => {
    const mono = montarCadastro([v({ id: 'a' })], []);
    expect(resolverCor(mono, { item_id: 'MLB1', variation_id: null, sku: null, gtin: null })?.variacao_id).toBe('a');
    const multi = montarCadastro([v({ id: 'a' }), v({ id: 'b' })], []);
    expect(resolverCor(multi, { item_id: 'MLB1', variation_id: null, sku: null, gtin: null })).toBeNull();
  });

  it('duplicata: linha sem custo nunca vence linha com custo, mesmo mais nova', () => {
    const c = montarCadastro([
      v({ id: 'com', codigo: '8', custo: 6, atualizado_em: '2026-01-01T00:00:00Z', familias: { ml_item_id: null, origem: 'nacional' } }),
      v({ id: 'sem', codigo: '8', custo: null, atualizado_em: '2026-09-01T00:00:00Z', familias: { ml_item_id: null, origem: 'nacional' } }),
    ], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '8', gtin: null })?.variacao_id).toBe('com');
  });

  it('duplicata de código: vence a linha mais recente (ADR-0108)', () => {
    const c = montarCadastro([
      v({ id: 'velha', codigo: '7', custo: 5, atualizado_em: '2026-01-01T00:00:00Z' }),
      v({ id: 'nova', codigo: '7', custo: 9, atualizado_em: '2026-09-01T00:00:00Z' }),
    ], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '7', gtin: null })?.custo).toBe(9);
  });

  it('custo ausente/≤0 ou não numérico vira null (⚪); origem inválida vira null', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '1', custo: 0, familias: { ml_item_id: 'M', origem: 'xx' } })], []);
    const r = resolverCor(c, { item_id: 'M', variation_id: 1, sku: null, gtin: null })!;
    expect(r.custo).toBeNull();
    expect(r.origem).toBeNull();
    expect(r.piso).toBe(18);
  });

  it('preço ≤0 vira piso null (evita verde falso com piso 0)', () => {
    for (const preco of [0, -5]) {
      const c = montarCadastro([v({ id: 'a', ml_variation_id: '1', preco })], []);
      expect(resolverCor(c, { item_id: 'M', variation_id: 1, sku: null, gtin: null })!.piso).toBeNull();
    }
  });

  it('dimensões inválidas viram null (o frete usa o default do ML)', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '1', altura_cm: null })], []);
    expect(resolverCor(c, { item_id: 'M', variation_id: 1, sku: null, gtin: null })!.dim).toBeNull();
  });

  it('nada casa → null', () => {
    expect(resolverCor(montarCadastro([], []), { item_id: 'Z', variation_id: 1, sku: 's', gtin: 'g' })).toBeNull();
  });
});

describe('resolverPack (kit — ADR-0151)', () => {
  // Caso real MLB7665740658: par de catálogo do kit, GTIN da unidade, SKU do kit próprio, UNITS_PER_PACK=2.
  const base = v({ id: 'base', codigo: '00000010', gtin: '7891010027858', custo: 29.9, preco: 39.99,
    peso_gramas: 800, altura_cm: 22, largura_cm: 10, comprimento_cm: 7, familias: { ml_item_id: 'MLBBASE', origem: 'nacional' } });
  const kit = v({ id: 'kit', codigo: '00000012', gtin: null, custo: 59.8, preco: 111.8,
    peso_gramas: 1600, altura_cm: 44, largura_cm: 10, comprimento_cm: 7,
    familias: { ml_item_id: 'MLBKIT', origem: 'nacional', kit_multiplicador: 2 } });
  const q = (o: Partial<{ item_id: string; sku: string | null; gtin: string | null }>) =>
    ({ item_id: 'MLBX', variation_id: null, sku: null, gtin: null, ...o });

  it('produto avulso sem UNITS_PER_PACK: igual ao resolverCor', () => {
    const c = montarCadastro([base], []);
    expect(resolverPack(c, q({ gtin: '7891010027858' }), null)).toBe(resolverCor(c, q({ gtin: '7891010027858' })));
    expect(resolverPack(c, q({ gtin: '7891010027858' }), 1)).toBe(resolverCor(c, q({ gtin: '7891010027858' })));
  });

  it('GTIN casa a unidade e o ML diz 2 unidades: custo/piso/peso/altura ×2, largura/comprimento da base', () => {
    const r = resolverPack(montarCadastro([base], []), q({ gtin: '7891010027858' }), 2);
    expect(r).toMatchObject({ variacao_id: 'base', custo: 59.8, piso: 79.98, kit: 2,
      dim: { altura_cm: 44, largura_cm: 10, comprimento_cm: 7, peso_gramas: 1600 } });
  });

  it('kit próprio já nasce multiplicado: nunca multiplica de novo (com ou sem UNITS_PER_PACK)', () => {
    const c = montarCadastro([base, kit], []);
    for (const n of [2, null]) {
      expect(resolverPack(c, q({ item_id: 'MLBKIT' }), n)).toMatchObject({ variacao_id: 'kit', custo: 59.8, piso: 111.8 });
    }
  });

  it('incidente: GTIN → unidade, SKU → kit próprio com o mesmo pacote → usa o kit próprio', () => {
    const r = resolverPack(montarCadastro([base, kit], []), q({ gtin: '7891010027858', sku: '00000012' }), 2);
    expect(r).toMatchObject({ variacao_id: 'kit', custo: 59.8, piso: 111.8 });
  });

  it('GTIN e SKU apontam cadastros que não batem no pacote → kit_ambiguo', () => {
    const outro = { ...kit, custo: 70 };
    expect(resolverPack(montarCadastro([base, outro], []), q({ gtin: '7891010027858', sku: '00000012' }), 2)).toBe('kit_ambiguo');
  });

  it('kit de 2 no cadastro, anúncio de 3 no ML → kit_divergente', () => {
    expect(resolverPack(montarCadastro([kit], []), q({ item_id: 'MLBKIT' }), 3)).toBe('kit_divergente');
    expect(resolverPack(montarCadastro([kit], []), q({ item_id: 'MLBKIT' }), 1)).toBe('kit_divergente');
  });

  it('kit sem medidas não cota frete padrão → kit_sem_dimensao', () => {
    const semDim = { ...base, altura_cm: null };
    expect(resolverPack(montarCadastro([semDim], []), q({ gtin: '7891010027858' }), 2)).toBe('kit_sem_dimensao');
    const kitSemDim = { ...kit, peso_gramas: null };
    expect(resolverPack(montarCadastro([kitSemDim], []), q({ item_id: 'MLBKIT' }), null)).toBe('kit_sem_dimensao');
  });

  it('kit sem UNITS_PER_PACK: SKU do kit próprio define o pacote (não cai no custo unitário)', () => {
    const r = resolverPack(montarCadastro([base, kit], []), q({ gtin: '7891010027858', sku: '00000012' }), null);
    expect(r).toMatchObject({ variacao_id: 'kit', custo: 59.8 });
  });

  it('SALE_FORMAT=Kit sem quantidade e sem cadastro de kit → ⚪ kit_divergente', () => {
    expect(resolverPack(montarCadastro([base], []), q({ gtin: '7891010027858' }), null, true)).toBe('kit_divergente');
    // sem o sinal de kit, avulso segue igual
    expect(resolverPack(montarCadastro([base], []), q({ gtin: '7891010027858' }), null, false)).toMatchObject({ variacao_id: 'base' });
  });

  it('mesmo custo e medidas mas origem fiscal diferente → kit_ambiguo', () => {
    const importado = { ...kit, familias: { ml_item_id: 'MLBKIT', origem: 'importado', kit_multiplicador: 2 } };
    expect(resolverPack(montarCadastro([base, importado], []), q({ gtin: '7891010027858', sku: '00000012' }), 2)).toBe('kit_ambiguo');
  });

  it('unidade sem medidas pelo GTIN + kit próprio completo pelo SKU → usa o kit próprio', () => {
    const semDim = { ...base, altura_cm: null };
    expect(resolverPack(montarCadastro([semDim, kit], []), q({ gtin: '7891010027858', sku: '00000012' }), 2))
      .toMatchObject({ variacao_id: 'kit', custo: 59.8 });
  });

  it('vínculo direto resolve o kit: o GTIN da unidade também é conferido (Codex, rodada 3)', () => {
    const qq = q({ item_id: 'MLBKIT', sku: '00000012', gtin: '7891010027858' });
    expect(resolverPack(montarCadastro([base, kit], []), qq, 2)).toMatchObject({ variacao_id: 'kit', custo: 59.8 });
    const baseReajustada = { ...base, custo: 35 };
    expect(resolverPack(montarCadastro([baseReajustada, kit], []), qq, 2)).toBe('kit_ambiguo');
  });

  it('nada casa → null', () => {
    expect(resolverPack(montarCadastro([], []), q({ gtin: '1' }), 2)).toBeNull();
  });
});

describe('resolverPack — anúncio próprio nunca escala (emenda ADR-0151, 2026-10-20)', () => {
  // Caso real Avil MLB7245026988: "Linha C/10 Novelos", custo R$ 64,09 já é do PACOTE; o ML diz UNITS_PER_PACK=10.
  const linha = v({ id: 'linha', codigo: '02436825', gtin: '3000024368251', custo: 64.0941, preco: 114,
    familias: { ml_item_id: 'MLB7245026988', origem: 'nacional' } });
  const q = (o: Partial<{ item_id: string; variation_id: number | null; sku: string | null; gtin: string | null }>) =>
    ({ item_id: 'MLBX', variation_id: null, sku: null, gtin: null, ...o });

  it('anúncio da própria família: custo do pacote como está, com qualquer UNITS_PER_PACK', () => {
    const c = montarCadastro([linha], []);
    for (const n of [10, 2, null]) {
      expect(resolverPack(c, q({ item_id: 'MLB7245026988', gtin: '3000024368251' }), n)).toMatchObject({ variacao_id: 'linha', custo: 64.0941, kit: 1 });
    }
    // SALE_FORMAT=Kit no próprio anúncio também não vira ⚪
    expect(resolverPack(c, q({ item_id: 'MLB7245026988' }), null, true)).toMatchObject({ variacao_id: 'linha', custo: 64.0941 });
  });

  it('item filho UP vinculado à variação e a própria ml_variation_id contam como anúncio próprio', () => {
    const up = montarCadastro([{ ...linha, familias: { ml_item_id: null, origem: 'nacional' } }], [{ item_externo_id: 'MLB900', variacao_id: 'linha' }]);
    expect(resolverPack(up, q({ item_id: 'MLB900' }), 10)).toMatchObject({ custo: 64.0941 });
    const legacy = montarCadastro([{ ...linha, ml_variation_id: '555' }, v({ id: 'outra', ml_variation_id: '556' })], []);
    expect(resolverPack(legacy, q({ item_id: 'MLB7245026988', variation_id: 555 }), 10)).toMatchObject({ variacao_id: 'linha', custo: 64.0941 });
  });

  it('par normal/catálogo (item_relations) de um anúncio próprio também não escala', () => {
    const c = montarCadastro([linha], []);
    expect(resolverPack(c, q({ item_id: 'MLBCAT', gtin: '3000024368251' }), 10, false, ['MLB7245026988']))
      .toMatchObject({ custo: 64.0941 });
  });

  it('anúncio próprio de pacote sem medidas segue recusado (kit_sem_dimensao), sem escalar (Codex P1)', () => {
    const semDim = montarCadastro([{ ...linha, altura_cm: null }], []);
    expect(resolverPack(semDim, q({ item_id: 'MLB7245026988' }), 10)).toBe('kit_sem_dimensao');
    expect(resolverPack(semDim, q({ item_id: 'MLB7245026988' }), null, true)).toBe('kit_sem_dimensao');
    // anúncio de uma unidade sem medidas: como sempre (o resto da cadeia decide)
    expect(resolverPack(semDim, q({ item_id: 'MLB7245026988' }), 1)).toMatchObject({ variacao_id: 'linha' });
  });

  it('catálogo Legacy da própria variação (relação COM variation_id) não escala; variação de outra cor não conta (Codex P2)', () => {
    const azul = { ...linha, ml_variation_id: '555', familias: { ml_item_id: 'MLBBASE', origem: 'nacional' as const } };
    const verde = v({ id: 'verde', gtin: '3000000000099', ml_variation_id: '556', custo: 10, familias: { ml_item_id: 'MLBBASE', origem: 'nacional' } });
    const c = montarCadastro([azul, verde], []);
    expect(resolverPack(c, q({ item_id: 'MLBCAT', gtin: '3000024368251' }), 10, false, [{ id: 'MLBBASE', variation_id: 555 }]))
      .toMatchObject({ variacao_id: 'linha', custo: 64.0941 });
    // a relação aponta a outra cor: não é o anúncio próprio desta variação → escala como antes
    expect(resolverPack(c, q({ item_id: 'MLBCAT', gtin: '3000024368251' }), 10, false, [{ id: 'MLBBASE', variation_id: 556 }]))
      .toMatchObject({ kit: 10 });
  });

  it('anúncio de OUTRO produto casado pelo GTIN da unidade continua escalando (caso original do ADR-0151)', () => {
    const c = montarCadastro([linha], []);
    expect(resolverPack(c, q({ item_id: 'MLBOUTRO', gtin: '3000024368251' }), 2)).toMatchObject({ custo: 128.19, kit: 2 });
    // relacionado que não é desta variação não muda nada
    expect(resolverPack(c, q({ item_id: 'MLBOUTRO', gtin: '3000024368251' }), 2, false, ['MLBQUALQUER'])).toMatchObject({ kit: 2 });
  });
});
