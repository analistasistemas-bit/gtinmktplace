import { describe, it, expect } from 'vitest';
import { tituloDoKit, precoSugeridoDoKit, descricaoDoKit, TITULO_MAX_KIT, contarKitsAguardandoPorPai } from '../kit';
import type { KitVinculado } from '../queries';

function criarKit(overrides: Partial<KitVinculado> = {}): KitVinculado {
  return {
    familiaId: 'kit-1',
    codigoPai: 'KIT001',
    kitBaseCodigoPai: 'PAI1',
    multiplicador: 3,
    status: 'pronto',
    mlPermalink: null,
    mlItemId: null,
    criadoEm: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const TITULO_NINHO = 'Leite em Pó Ninho Zero Lactose 700g';

/** Fixture estilo descrição IA do Ninho — FAQ + O QUE VOCÊ RECEBE com "1 unidade". */
const DESCRICAO_NINHO = `Leite em pó zero lactose, sabor suave.

O QUE VOCÊ RECEBE
• 1 unidade de Leite em Pó Ninho Zero Lactose 700g
• Embalagem lacrada de fábrica

CONTEÚDO DA EMBALAGEM
• 1 unidade com 700g de produto

FAQ
Qual a unidade de venda? 1 unidade`;

describe('tituloDoKit', () => {
  it('coloca o tamanho do kit como prefixo do título da base', () => {
    expect(tituloDoKit('Fita Adesiva Transparente 45mm', 3))
      .toBe('Kit 3 Unidades Fita Adesiva Transparente 45mm');
  });

  it('exemplo Ninho N=2: prefixo intacto, base truncada só se necessário', () => {
    expect(tituloDoKit(TITULO_NINHO, 2))
      .toBe('Kit 2 Unidades Leite em Pó Ninho Zero Lactose 700g');
  });

  it('nunca ultrapassa 60 caracteres — corta o título da base, não o prefixo', () => {
    const base = 'Fita Adesiva Transparente Dupla Face Extra Forte 45mm x 50m';
    const r = tituloDoKit(base, 6);
    expect(r.length).toBeLessThanOrEqual(TITULO_MAX_KIT);
    expect(r.startsWith('Kit 6 Unidades')).toBe(true);
  });

  it('não corta no meio de uma palavra', () => {
    const r = tituloDoKit('Fita Adesiva Transparente Dupla Face Extra Forte 45mm', 2);
    expect(r).not.toMatch(/\s\S+?-?\s?Kit 2 Unidades$/u.source.length ? / {2}/ : / {2}/);
    expect(r.trim()).toBe(r);
    expect(r.startsWith('Kit 2 Unidades')).toBe(true);
  });
});

describe('precoSugeridoDoKit', () => {
  it('multiplica o preço unitário pelo tamanho', () => {
    expect(precoSugeridoDoKit(19.9, 3)).toBe(59.7);
  });
  it('aplica o desconto opcional sobre o total', () => {
    expect(precoSugeridoDoKit(100, 2, 10)).toBe(180);
  });
  it('arredonda a 2 casas', () => {
    expect(precoSugeridoDoKit(19.99, 3, 7)).toBe(55.77);
  });
});

describe('descricaoDoKit', () => {
  it('adapta FAQ e bullets estilo Ninho sem append solto no final', () => {
    const r = descricaoDoKit(DESCRICAO_NINHO, 2, TITULO_NINHO);
    expect(r).toContain('Qual a unidade de venda? Kit com 2 unidades.');
    expect(r).toContain('• 2 unidades de Leite em Pó Ninho Zero Lactose 700g');
    expect(r).toContain('• 2 unidades, cada uma com 700g de produto');
    expect(r).not.toMatch(/\n\nKit com 2 unidades\.\s*$/);
    expect(r).toContain('Embalagem lacrada de fábrica');
  });

  it('metragem: "1 unidade com" vira "N unidades, cada uma com"', () => {
    const base = `Fita adesiva profissional.

O QUE VOCÊ RECEBE
• 1 unidade com 10m de fita`;
    const r = descricaoDoKit(base, 3, 'Fita Adesiva 45mm');
    expect(r).toContain('• 3 unidades, cada uma com 10m de fita');
    expect(r).not.toContain('3 unidades com 10m');
  });

  it('cria seção O QUE VOCÊ RECEBE quando ausente e nada foi adaptado', () => {
    const r = descricaoDoKit('Fita de boa qualidade.', 4, 'Fita Adesiva Transparente 45mm');
    expect(r).toBe(
      'Fita de boa qualidade.\n\n📦 O QUE VOCÊ RECEBE\n\n• 4 unidades de Fita Adesiva Transparente 45mm',
    );
    expect(r).not.toContain('Kit com 4 unidades.');
  });

  it('plural correto para N=3', () => {
    const r = descricaoDoKit(DESCRICAO_NINHO, 3, TITULO_NINHO);
    expect(r).toContain('Kit com 3 unidades.');
    expect(r).toContain('• 3 unidades de ');
    expect(r).toContain('• 3 unidades, cada uma com ');
  });

  it('CA-2.4: ESPECIFICAÇÕES com • 1 unidade de X permanece inalterado', () => {
    const base = `Intro.

📌 ESPECIFICAÇÕES
• 1 unidade de embalagem econômica
• Marca: Teste`;
    const r = descricaoDoKit(base, 3, 'Produto X');
    expect(r).toContain('• 1 unidade de embalagem econômica');
    expect(r).not.toContain('• 3 unidades de embalagem');
  });

  it('R2-C: FAQ adaptado sem seção conteúdo cria O QUE VOCÊ RECEBE', () => {
    const base = `Produto.

❓ PERGUNTAS SOBRE ESTE PRODUTO
▪ Qual a unidade de venda? 1 unidade`;
    const r = descricaoDoKit(base, 2, 'Produto ABC');
    expect(r).toContain('Qual a unidade de venda? Kit com 2 unidades.');
    expect(r).toContain('📦 O QUE VOCÊ RECEBE');
    expect(r).toContain('• 2 unidades de Produto ABC');
  });

  it('adapta • 1 peça(s) somente na seção conteúdo', () => {
    const base = `O QUE VOCÊ RECEBE
• 1 peça
• 1 peças de reserva`;
    const r = descricaoDoKit(base, 2, 'Parafuso M6');
    expect(r).toContain('• 2 peças');
    expect(r).toContain('• 1 peças de reserva');
  });

  it('adapta • 1 caixa com X unidades para N unidades de tituloBase (Spec R2-A)', () => {
    const base = `📦 O QUE VOCÊ RECEBE

• 1 caixa com 12 unidades`;
    const r = descricaoDoKit(base, 2, 'Caneta BIC');
    expect(r).toContain('• 2 unidades de Caneta BIC');
    expect(r).not.toContain('1 caixa com 12');
  });

  it('FAQ ❓ PERGUNTAS: adapta "quantas unidades" e "o que vem" e cria seção conteúdo', () => {
    const base = `Produto teste.

❓ PERGUNTAS SOBRE ESTE PRODUTO
▪ Quantas unidades vêm na embalagem? 1 unidade
▪ O que vem junto? 1 unidade`;
    const r = descricaoDoKit(base, 2, 'Produto Teste ABC');
    expect(r).toContain('▪ Quantas unidades vêm na embalagem? 2 unidades.');
    expect(r).toContain('▪ O que vem junto? 2 unidades de Produto Teste ABC.');
    expect(r).toContain('📦 O QUE VOCÊ RECEBE');
    expect(r).toContain('• 2 unidades de Produto Teste ABC');
  });

  it('remove append duplicado "Kit com N unidades." se já existia na base', () => {
    const base = 'Descrição simples.\n\nKit com 2 unidades.';
    const r = descricaoDoKit(base, 2, 'Produto X');
    expect(r).toContain('📦 O QUE VOCÊ RECEBE');
    expect(r).toContain('• 2 unidades de Produto X');
    expect(r).not.toMatch(/\n\nKit com 2 unidades\.\s*$/);
  });
});

describe('contarKitsAguardandoPorPai', () => {
  it('conta kit pronto e ainda sem ml_item_id', () => {
    const mapa = contarKitsAguardandoPorPai([criarKit({ status: 'pronto', mlItemId: null })]);
    expect(mapa.get('PAI1')).toBe(1);
  });

  it('não conta kit publicado', () => {
    const mapa = contarKitsAguardandoPorPai([criarKit({ status: 'publicado', mlItemId: 'ML123' })]);
    expect(mapa.get('PAI1')).toBeUndefined();
  });

  it('não conta kit em erro', () => {
    const mapa = contarKitsAguardandoPorPai([criarKit({ status: 'erro', mlItemId: null })]);
    expect(mapa.get('PAI1')).toBeUndefined();
  });

  it('não conta kit pronto mas já com ml_item_id preenchido', () => {
    const mapa = contarKitsAguardandoPorPai([criarKit({ status: 'pronto', mlItemId: 'ML123' })]);
    expect(mapa.get('PAI1')).toBeUndefined();
  });

  it('agrupa corretamente por codigoPai quando há kits de produtos diferentes', () => {
    const mapa = contarKitsAguardandoPorPai([
      criarKit({ kitBaseCodigoPai: 'PAI1', status: 'pronto', mlItemId: null }),
      criarKit({ kitBaseCodigoPai: 'PAI1', status: 'pronto', mlItemId: null, multiplicador: 4 }),
      criarKit({ kitBaseCodigoPai: 'PAI2', status: 'pronto', mlItemId: null }),
      criarKit({ kitBaseCodigoPai: 'PAI2', status: 'publicado', mlItemId: 'ML9' }),
    ]);
    expect(mapa.get('PAI1')).toBe(2);
    expect(mapa.get('PAI2')).toBe(1);
  });
});
