import { describe, expect, it } from 'vitest';
import { migracaoEmAndamento, motivoAnuncioNaoAtualizavel } from '../anuncio-atualizavel.ts';

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

// ADR-0160 (I9) — a janela do UPtin.
//
// "Oferecer preço por variação" no painel do ML dispara uma migração ASSÍNCRONA: o item original
// continua ATIVO (tags `variations_migration_pending` + `variations_migration_source`) enquanto o
// ML clona cada variação num item novo (nasce `paused`, com `_pending` + `_uptin`). Só no fim os
// clones são ativados e o original é encerrado.
//
// Um PUT nessa janela é o pior caso possível: o ML responde 200, o app grava `preco_publicado_ml`
// como confirmado — e os clones, criados a partir do estado ANTERIOR ao PUT, entram no ar com o
// preço velho. Banco e vitrine divergem, o badge "preço alterado" fica apagado, e nada sinaliza.
describe('migracaoEmAndamento (ADR-0160 I9)', () => {
  it('item sem tags não está em migração', () => {
    expect(migracaoEmAndamento({ tags: [] })).toBeNull();
    expect(migracaoEmAndamento({})).toBeNull();
    expect(migracaoEmAndamento({ tags: null })).toBeNull();
  });

  it('item original em migração bloqueia o PUT', () => {
    const m = migracaoEmAndamento({ tags: ['variations_migration_pending', 'variations_migration_source'] });
    expect(m).toMatch(/migra/i);
    expect(m).toMatch(/preço por variação/i);
  });

  it('clone recém-criado (pending + uptin) também bloqueia', () => {
    expect(migracaoEmAndamento({ tags: ['variations_migration_pending', 'variations_migration_uptin'] }))
      .toMatch(/migra/i);
  });

  // `pending` é a ÚNICA tag que prova "em andamento": a doc oficial diz que ela cai dos dois lados
  // quando a migração conclui. `_uptin` identifica o clone e não há garantia documentada de que
  // suma — bloquear por ela deixaria todo item migrado permanentemente inatualizável, um bug pior
  // que o evitado.
  it('clone já concluído (só uptin, sem pending) É atualizável', () => {
    expect(migracaoEmAndamento({ tags: ['variations_migration_uptin'] })).toBeNull();
  });

  // O item original encerrado guarda `_source` para sempre. Barrar por ela atrapalharia a detecção
  // de dissolução do ADR-0105, que precisa justamente alcançar o item closed para achar a sucessora.
  it('item original já encerrado (só source, sem pending) não é barrado por esta trava', () => {
    expect(migracaoEmAndamento({ tags: ['variations_migration_source'] })).toBeNull();
  });

  it('ignora tags não-string sem quebrar', () => {
    expect(migracaoEmAndamento({ tags: [null, 42, 'variations_migration_pending'] as unknown as string[] }))
      .toMatch(/migra/i);
  });
});
