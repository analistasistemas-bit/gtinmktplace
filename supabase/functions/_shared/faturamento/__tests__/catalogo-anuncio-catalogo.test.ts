import { describe, it, expect } from 'vitest';
import { carregarCatalogo } from '../io';

/**
 * ADR-0021 — vincular um produto ao catálogo do ML cria um anúncio SEPARADO, com MLB próprio
 * (`variacoes.catalog_listing_id`), diferente de `familias.ml_item_id`. A venda desse anúncio
 * chega com `item.id` = MLB de catálogo e sem `variation_id`.
 *
 * Antes, o catálogo do faturamento só conhecia o `ml_item_id` da família: a venda de catálogo era
 * reconhecida apenas pelo fallback de GTIN (venda.ts §2). Produto sem EAN cadastrado ficava sem
 * código — e sem código não há baixa de estoque.
 */
const ORG = 'org-1111';
const USER = 'user-2222';

type Linha = Record<string, unknown>;

function criarAdminFake(tabelas: Record<string, Linha[]>) {
  function query(tabela: string) {
    const alvo = {
      select: () => alvo,
      not: () => alvo,
      eq: () => alvo,
      range: (de: number) => Promise.resolve({ data: de === 0 ? (tabelas[tabela] ?? []) : [], error: null }),
      maybeSingle: () => Promise.resolve({ data: { org_id: ORG }, error: null }),
    };
    return alvo;
  }
  return { from: (tabela: string) => query(tabela) };
}

const FAMILIA = { id: 'fam-1', ml_item_id: 'MLB5040504553', codigo_pai: '00000027' };

function catalogoCom(variacao: Linha) {
  return carregarCatalogo(
    criarAdminFake({ familias: [FAMILIA], variacoes: [variacao] }) as never,
    USER,
  );
}

describe('carregarCatalogo — anúncio de catálogo (ADR-0021)', () => {
  it('reconhece o MLB de catálogo como anúncio nosso', async () => {
    const cat = await catalogoCom({
      familia_id: 'fam-1', codigo: '00000029', gtin: '7891113017268',
      ml_variation_id: null, catalog_listing_id: 'MLB7389260688', custo: 10, atualizado_em: null,
    });
    expect(cat.idsPubliai.has('MLB7389260688')).toBe(true);
    // O anúncio dono continua reconhecido — o de catálogo soma, não substitui.
    expect(cat.idsPubliai.has('MLB5040504553')).toBe(true);
  });

  it('resolve código e EAN pelo MLB de catálogo, sem variation_id', async () => {
    const cat = await catalogoCom({
      familia_id: 'fam-1', codigo: '00000029', gtin: '7891113017268',
      ml_variation_id: null, catalog_listing_id: 'MLB7389260688', custo: 10, atualizado_em: null,
    });
    expect(cat.codigoResolver('MLB7389260688', null)).toBe('00000029');
    expect(cat.eanResolver('MLB7389260688', null)).toBe('7891113017268');
  });

  // A razão de ser da mudança: sem GTIN, o fallback de venda.ts §2 não tem por onde casar.
  it('resolve o código mesmo quando a variação não tem GTIN', async () => {
    const cat = await catalogoCom({
      familia_id: 'fam-1', codigo: '00000029', gtin: null,
      ml_variation_id: null, catalog_listing_id: 'MLB7389260688', custo: 10, atualizado_em: null,
    });
    expect(cat.idsPubliai.has('MLB7389260688')).toBe(true);
    expect(cat.codigoResolver('MLB7389260688', null)).toBe('00000029');
    expect(cat.eanResolver('MLB7389260688', null)).toBeNull();
  });

  it('não inventa entrada para variação sem anúncio de catálogo', async () => {
    const cat = await catalogoCom({
      familia_id: 'fam-1', codigo: '00000029', gtin: '7891113017268',
      ml_variation_id: null, catalog_listing_id: null, custo: 10, atualizado_em: null,
    });
    expect(cat.idsPubliai.has('MLB7389260688')).toBe(false);
    expect(cat.codigoResolver('MLB7389260688', null)).toBeNull();
  });

  // O código do catálogo é o da VARIAÇÃO vinculada, não o `codigo_pai` do agrupador nem o da
  // primeira variação da família — cada anúncio de catálogo aponta para um produto específico.
  it('usa o código da variação vinculada, não o do pai', async () => {
    const admin = criarAdminFake({
      familias: [FAMILIA],
      variacoes: [
        { familia_id: 'fam-1', codigo: '00000028', gtin: '7891113017111', ml_variation_id: '111', catalog_listing_id: null, custo: 10, atualizado_em: null },
        { familia_id: 'fam-1', codigo: '00000029', gtin: '7891113017268', ml_variation_id: '222', catalog_listing_id: 'MLB7389260688', custo: 10, atualizado_em: null },
      ],
    });
    const cat = await carregarCatalogo(admin as never, USER);
    expect(cat.codigoResolver('MLB7389260688', null)).toBe('00000029');
  });
});
