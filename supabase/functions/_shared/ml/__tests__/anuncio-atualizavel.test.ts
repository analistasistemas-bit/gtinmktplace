import { describe, expect, it } from 'vitest';
import { motivoAnuncioNaoAtualizavel } from '../anuncio-atualizavel.ts';

describe('motivoAnuncioNaoAtualizavel', () => {
  it('anúncio ativo pode ser atualizado', () => {
    expect(motivoAnuncioNaoAtualizavel({ status: 'active', subStatus: [] })).toBeNull();
  });

  // Pausado é o estado normal de quem zerou estoque (ADR-0060) — bloquear aqui impediria repor.
  it('anúncio pausado PODE ser atualizado (repor estoque é o caminho de volta)', () => {
    expect(motivoAnuncioNaoAtualizavel({ status: 'paused', subStatus: [] })).toBeNull();
  });

  // Os 6 casos reais do lote #45.
  it('closed bloqueia, com a causa certa', () => {
    const m = motivoAnuncioNaoAtualizavel({ status: 'closed', subStatus: [] });
    expect(m).toMatch(/closed/);
    expect(m).toMatch(/republique/i);
  });

  it('inactive bloqueia', () => {
    expect(motivoAnuncioNaoAtualizavel({ status: 'inactive', subStatus: [] })).toMatch(/inactive/);
  });

  it('sub_status deleted bloqueia mesmo com status que pareceria ok', () => {
    const m = motivoAnuncioNaoAtualizavel({ status: 'paused', subStatus: ['deleted', 'paused_by_seller'] });
    expect(m).toMatch(/removido/i);
    expect(m).toMatch(/deleted/);
  });

  it('sub_status forbidden bloqueia', () => {
    expect(motivoAnuncioNaoAtualizavel({ status: 'inactive', subStatus: ['forbidden', 'deleted'] }))
      .toMatch(/removido/i);
  });

  // O sub_status tem precedência: é a causa mais específica e mais acionável.
  it('sub_status morto tem precedência sobre o status na mensagem', () => {
    expect(motivoAnuncioNaoAtualizavel({ status: 'closed', subStatus: ['deleted'] })).toMatch(/removido/i);
  });

  // Fail-open deliberado: status transitório/novo segue para o PUT em vez de travar em silêncio.
  it('under_review NÃO bloqueia (transitório — o ML volta a aceitar sozinho)', () => {
    expect(motivoAnuncioNaoAtualizavel({ status: 'under_review', subStatus: [] })).toBeNull();
  });

  it('status futuro desconhecido NÃO bloqueia (deixa o ML decidir)', () => {
    expect(motivoAnuncioNaoAtualizavel({ status: 'algum_status_novo_do_ml', subStatus: [] })).toBeNull();
  });

  it('ausência de status não bloqueia', () => {
    expect(motivoAnuncioNaoAtualizavel({})).toBeNull();
    expect(motivoAnuncioNaoAtualizavel({ status: null, subStatus: null })).toBeNull();
  });

  it('sub_status irrelevante (ex.: paused_by_seller sozinho) não bloqueia', () => {
    expect(motivoAnuncioNaoAtualizavel({ status: 'paused', subStatus: ['paused_by_seller'] })).toBeNull();
  });
});
