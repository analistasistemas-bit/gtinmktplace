import { describe, expect, it } from 'vitest';
import { type FatosElegibilidade, motivoInelegivel } from '../elegibilidade.ts';

const ok = (): FatosElegibilidade => ({
  vivo: { preco: 10, variacoes: null, status: 'active', sub_status: [], catalog_listing: false, tem_relacoes: false },
  ehKit: false, temAtacado: false, promocaoBanco: false, promocaoML: false, familiaPublicando: false, migracaoPxv: false,
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
  it('promoção no banco ou no ML', () => {
    expect(motivoInelegivel({ ...ok(), promocaoBanco: true })).toBe('Participando de promoção');
    expect(motivoInelegivel({ ...ok(), promocaoML: true })).toBe('Participando de promoção');
  });
  it('promoção inconclusiva', () => {
    expect(motivoInelegivel({ ...ok(), promocaoML: null })).toBe('Não foi possível conferir promoções — tente de novo');
  });
  it('promoção no banco vence a inconclusiva', () => {
    expect(motivoInelegivel({ ...ok(), promocaoBanco: true, promocaoML: null })).toBe('Participando de promoção');
  });
  it('família publicando', () => expect(motivoInelegivel({ ...ok(), familiaPublicando: true })).toBe('Família em publicação/atualização'));
  it('migração PxV', () => expect(motivoInelegivel({ ...ok(), migracaoPxv: true })).toBe('Migração para preço por variação em curso'));
  it('ordem: moderado > kit > catálogo > atacado > promoção > inconclusiva > família > migração', () => {
    const t: FatosElegibilidade = {
      vivo: { preco: 10, variacoes: null, status: 'closed', sub_status: [], catalog_listing: true, tem_relacoes: true },
      ehKit: true, temAtacado: true, promocaoBanco: true, promocaoML: null, familiaPublicando: true, migracaoPxv: true,
    };
    expect(motivoInelegivel(t)).toBe(MODERADO);
    t.vivo.status = 'active';
    expect(motivoInelegivel(t)).toBe('Kit Virtual não entra no reajuste');
    t.ehKit = false;
    expect(motivoInelegivel(t)).toBe('Anúncio de catálogo (ou com par de catálogo) fica fora do reajuste');
    t.vivo.catalog_listing = false; t.vivo.tem_relacoes = false;
    expect(motivoInelegivel(t)).toBe('Anúncio com preço de atacado fica fora do reajuste');
    t.temAtacado = false;
    expect(motivoInelegivel(t)).toBe('Participando de promoção');
    t.promocaoBanco = false;
    expect(motivoInelegivel(t)).toBe('Não foi possível conferir promoções — tente de novo');
    t.promocaoML = false;
    expect(motivoInelegivel(t)).toBe('Família em publicação/atualização');
    t.familiaPublicando = false;
    expect(motivoInelegivel(t)).toBe('Migração para preço por variação em curso');
  });
});
