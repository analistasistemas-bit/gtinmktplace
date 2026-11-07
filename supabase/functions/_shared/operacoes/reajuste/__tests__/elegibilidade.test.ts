import { describe, expect, it } from 'vitest';
import { type FatosElegibilidade, motivoInelegivel, motivoTravaOferta } from '../elegibilidade.ts';
import { oferta } from '../ofertas.ts';

const o = (id: string, preco: number | null) => oferta({ promocao_id: id, tipo: 'DEAL', status: 'started', preco, offer_id: null, inicio: null, fim: null });

const ok = (): FatosElegibilidade => ({
  vivo: { preco: 10, variacoes: null, status: 'active', sub_status: [], catalog_listing: false, tem_relacoes: false },
  ehKit: false, temAtacado: false, ofertas: [], familiaPublicando: false, migracaoPxv: false,
});
const MODERADO = 'Anúncio moderado, encerrado ou inativo';

describe('motivoInelegivel', () => {
  it('elegível → null (active e paused)', () => {
    expect(motivoInelegivel(ok())).toBeNull();
    const f = ok(); f.vivo.status = 'paused';
    expect(motivoInelegivel(f)).toBeNull();
  });
  it('status fora de active/paused → moderado', () => {
    for (const s of ['closed', 'under_review', 'inactive']) {
      const f = ok(); f.vivo.status = s;
      expect(motivoInelegivel(f)).toBe(MODERADO);
    }
  });
  it('sub_status bloqueante → moderado; out_of_stock sozinho não bloqueia', () => {
    for (const s of ['forbidden', 'waiting_for_patch', 'poor_quality_thumbnail', 'poor_quality_picture']) {
      const f = ok(); f.vivo.sub_status = ['out_of_stock', s];
      expect(motivoInelegivel(f)).toBe(MODERADO);
    }
    const f = ok(); f.vivo.sub_status = ['out_of_stock'];
    expect(motivoInelegivel(f)).toBeNull();
  });
  it('kit', () => expect(motivoInelegivel({ ...ok(), ehKit: true })).toBe('Kit Virtual não entra no reajuste'));
  it('catálogo ou relações', () => {
    const msg = 'Anúncio de catálogo (ou com par de catálogo) fica fora do reajuste';
    const a = ok(); a.vivo.catalog_listing = true;
    const b = ok(); b.vivo.tem_relacoes = true;
    expect(motivoInelegivel(a)).toBe(msg);
    expect(motivoInelegivel(b)).toBe(msg);
  });
  it('atacado', () => expect(motivoInelegivel({ ...ok(), temAtacado: true })).toBe('Anúncio com preço de atacado fica fora do reajuste'));
  it('oferta vigente deixa de excluir', () => {
    expect(motivoInelegivel({ ...ok(), ofertas: [o('P', 39.9)] })).toBeNull();
  });
  it('promoção inconclusiva', () => {
    expect(motivoInelegivel({ ...ok(), ofertas: null })).toBe('Não foi possível conferir promoções — tente de novo');
  });
  it.each(['LIGHTNING', 'SMART_LIGHTNING'])('%s started fica fora (até o Teste 2); pending não', (tipo) => {
    expect(motivoInelegivel({ ...ok(), ofertas: [{ ...o('L', 100), tipo }] })).toMatch(/Relâmpago/);
    expect(motivoInelegivel({ ...ok(), ofertas: [{ ...o('L', 100), tipo, status: 'pending' }] })).toBeNull();
  });
  it('família publicando', () => expect(motivoInelegivel({ ...ok(), familiaPublicando: true })).toBe('Família em publicação/atualização'));
  it('migração PxV', () => expect(motivoInelegivel({ ...ok(), migracaoPxv: true })).toBe('Migração para preço por variação em curso'));
  it('ordem: moderado > kit > catálogo > atacado > inconclusiva > família > migração', () => {
    const t: FatosElegibilidade = {
      vivo: { preco: 10, variacoes: null, status: 'closed', sub_status: [], catalog_listing: true, tem_relacoes: true },
      ehKit: true, temAtacado: true, ofertas: null, familiaPublicando: true, migracaoPxv: true,
    };
    expect(motivoInelegivel(t)).toBe(MODERADO);
    t.vivo.status = 'active';
    expect(motivoInelegivel(t)).toBe('Kit Virtual não entra no reajuste');
    t.ehKit = false;
    expect(motivoInelegivel(t)).toBe('Anúncio de catálogo (ou com par de catálogo) fica fora do reajuste');
    t.vivo.catalog_listing = false; t.vivo.tem_relacoes = false;
    expect(motivoInelegivel(t)).toBe('Anúncio com preço de atacado fica fora do reajuste');
    t.temAtacado = false;
    expect(motivoInelegivel(t)).toBe('Não foi possível conferir promoções — tente de novo');
    t.ofertas = [];
    expect(motivoInelegivel(t)).toBe('Família em publicação/atualização');
    t.familiaPublicando = false;
    expect(motivoInelegivel(t)).toBe('Migração para preço por variação em curso');
  });
});

describe('motivoTravaOferta', () => {
  it('alvo igual ou abaixo da maior oferta trava; um centavo acima passa', () => {
    expect(motivoTravaOferta(39.9, [o('P', 39.9)])).toBe('Preço igual ou abaixo da oferta de R$ 39,90 — ajuste a oferta antes');
    expect(motivoTravaOferta(39.91, [o('P', 39.9)])).toBeNull();
  });
  it('vale a maior das ofertas', () => {
    expect(motivoTravaOferta(50, [o('P', 39.9), o('Q', 1234.5)])).toMatch(/R\$ 1\.234,50/);
  });
  it('sem ofertas não trava', () => expect(motivoTravaOferta(10, [])).toBeNull());
  it('oferta sem preço comprovado é inconclusiva', () => {
    expect(motivoTravaOferta(500, [o('P', 39.9), o('Q', null)])).toBe('Não foi possível conferir promoções — tente de novo');
  });
});
