import { describe, it, expect } from 'vitest';
import { parseStatusML } from '../status';

describe('parseStatusML', () => {
  it('active → ativo', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'active', available_quantity: 10, price: 12.9 });
    expect(r).toMatchObject({ status: 'ativo', estoque: 10, preco: 12.9, motivo: null });
  });
  it('under_review com sub_status vira moderado + motivo', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'under_review', sub_status: ['waiting_for_patch'], available_quantity: 0, price: 5 });
    expect(r.status).toBe('moderado');
    expect(r.motivo).toContain('waiting_for_patch');
  });
  it('forbidden no sub_status vira moderado mesmo já inactive+deleted', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'inactive', sub_status: ['forbidden', 'deleted'], available_quantity: 0, price: 5 });
    expect(r.status).toBe('moderado');
    expect(r.motivo).toContain('forbidden');
  });
  // 2026-08-25: `suspended_for_prevention` é pausa preventiva do ML (item sem vendas/abandonado,
  // preço atípico, imagem por URL não processada), não infração — alertava como "moderado".
  it('under_review só com suspended_for_prevention → pausado, sem motivo', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'under_review', sub_status: ['suspended_for_prevention'], available_quantity: 0 });
    expect(r.status).toBe('pausado');
    expect(r.motivo).toBeNull();
  });
  it('suspended_for_prevention junto de marcador de moderação segue moderado', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'under_review', sub_status: ['suspended_for_prevention', 'forbidden'] });
    expect(r.status).toBe('moderado');
    expect(r.motivo).toContain('forbidden');
  });
  it('paused + suspended_for_prevention → pausado', () => {
    expect(parseStatusML({ id: 'x', status: 'paused', sub_status: ['suspended_for_prevention'] }).status).toBe('pausado');
  });
  it('under_review sem sub_status segue moderado', () => {
    expect(parseStatusML({ id: 'x', status: 'under_review' }).status).toBe('moderado');
  });
  it('poor_quality_thumbnail conta como moderado', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'inactive', sub_status: ['poor_quality_thumbnail'] });
    expect(r.status).toBe('moderado');
  });
  it('paused → pausado; closed → encerrado; inactive sem moderação → inativo', () => {
    expect(parseStatusML({ id: 'x', status: 'paused' }).status).toBe('pausado');
    expect(parseStatusML({ id: 'x', status: 'closed' }).status).toBe('encerrado');
    expect(parseStatusML({ id: 'x', status: 'inactive' }).status).toBe('inativo');
    expect(parseStatusML({ id: 'x', status: 'inactive', sub_status: ['out_of_stock'] }).status).toBe('inativo');
  });
  it('null/erro → indisponivel', () => {
    expect(parseStatusML(null).status).toBe('indisponivel');
  });

  it('listing_type_id gold_special → classico; gold_pro → premium', () => {
    expect(parseStatusML({ id: 'x', status: 'active', listing_type_id: 'gold_special' }).listingType).toBe('classico');
    expect(parseStatusML({ id: 'x', status: 'active', listing_type_id: 'gold_pro' }).listingType).toBe('premium');
  });
  it('listing_type ausente ou desconhecido → null', () => {
    expect(parseStatusML({ id: 'x', status: 'active' }).listingType).toBeNull();
    expect(parseStatusML({ id: 'x', status: 'active', listing_type_id: 'free' }).listingType).toBeNull();
  });
  it('item null → listingType null', () => {
    expect(parseStatusML(null).listingType).toBeNull();
  });

  // Fase 3 (2026-08-13): catalog_forewarning é a tag que o ML expõe para "próximo a ser
  // pausado" — fonte real, substitui a inferência local por catalog_status.
  it('tag catalog_forewarning presente → catalogForewarning true', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'active', tags: ['catalog_listing_eligible', 'catalog_forewarning'] });
    expect(r.catalogForewarning).toBe(true);
  });
  it('sem a tag → catalogForewarning false', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'active', tags: ['catalog_listing_eligible'] });
    expect(r.catalogForewarning).toBe(false);
  });
  it('sem tags no payload → catalogForewarning false', () => {
    expect(parseStatusML({ id: 'MLB1', status: 'active' }).catalogForewarning).toBe(false);
  });
  it('item null → catalogForewarning false', () => {
    expect(parseStatusML(null).catalogForewarning).toBe(false);
  });
});
