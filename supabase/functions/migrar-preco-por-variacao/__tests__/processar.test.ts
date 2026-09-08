import { describe, it, expect } from 'vitest';
import { dispararMigracaoPxv, type PortasDisparo } from '../processar';
import type { VariacaoSnapshot } from '../../_shared/ml/migracao-pxv';

const SNAP: VariacaoSnapshot[] = [
  { id: '1', sku: '00000001', cor: 'Azul' },
  { id: '2', sku: '00000002', cor: 'Rosa' },
];

/** Mundo fake: registra tudo que tocaria o ML, para provar que uma recusa não escreve nada. */
function fakeMundo(over: Partial<{
  familia: { id: string; orgId: string; codigoPai: string; mlItemId: string | null; status: string | null } | null;
  particoes: Array<{ particao: number; itemExternoId: string | null; migracaoStatus: string | null }>;
  mlItemIdMaisNovo: string | null;
  algumaPublicando: boolean;
  emKitVirtual: boolean;
  elegivel: boolean;
  causas: string[];
  snapshot: VariacaoSnapshot[];
  reservaOk: boolean;
  falharDisparo: string | null;
}> = {}) {
  const chamadas = {
    validou: 0, leuVariacoes: 0, reservou: 0, disparou: 0,
    falhasRegistradas: [] as string[], acompanhamentos: 0,
  };
  const portas: PortasDisparo = {
    carregarContexto: () => Promise.resolve({
      familia: over.familia === undefined
        ? { id: 'fam-1', orgId: 'org-1', codigoPai: '000123', mlItemId: 'MLB1', status: 'publicado' }
        : over.familia,
      particoes: over.particoes ?? [{ particao: 0, itemExternoId: 'MLB1', migracaoStatus: null }],
      mlItemIdMaisNovo: over.mlItemIdMaisNovo === undefined ? 'MLB1' : over.mlItemIdMaisNovo,
      algumaPublicando: over.algumaPublicando ?? false,
      emKitVirtual: over.emKitVirtual ?? false,
    }),
    validarElegibilidade: () => {
      chamadas.validou += 1;
      return Promise.resolve({ elegivel: over.elegivel ?? true, causas: over.causas ?? [] });
    },
    lerVariacoes: () => {
      chamadas.leuVariacoes += 1;
      return Promise.resolve(over.snapshot ?? SNAP);
    },
    reservar: () => { chamadas.reservou += 1; return Promise.resolve(over.reservaOk ?? true); },
    dispararNoML: () => {
      chamadas.disparou += 1;
      if (over.falharDisparo) return Promise.reject(new Error(over.falharDisparo));
      return Promise.resolve();
    },
    registrarFalha: (_pai, motivo) => { chamadas.falhasRegistradas.push(motivo); return Promise.resolve(); },
    enfileirarAcompanhamento: () => { chamadas.acompanhamentos += 1; return Promise.resolve(); },
  };
  return { portas, chamadas };
}

describe('dispararMigracaoPxv — caminho feliz', () => {
  it('valida, tira snapshot, reserva e dispara — nesta ordem', async () => {
    const w = fakeMundo();
    const r = await dispararMigracaoPxv(w.portas, 'fam-1');
    expect(r).toEqual({ tipo: 'ok', codigoPai: '000123' });
    expect(w.chamadas.validou).toBe(1);
    expect(w.chamadas.leuVariacoes).toBe(1);
    expect(w.chamadas.reservou).toBe(1);
    expect(w.chamadas.disparou).toBe(1);
    expect(w.chamadas.acompanhamentos).toBe(1);
  });
});

// Cada recusa tem que provar que o ML não foi tocado. A migração é IRREVERSÍVEL: um disparo
// indevido não tem desfazer, então "recusou mas chamou o ML" seria falha total, não parcial.
describe('dispararMigracaoPxv — recusas antes de qualquer escrita no ML', () => {
  const semEscrita = (w: ReturnType<typeof fakeMundo>) => {
    expect(w.chamadas.disparou).toBe(0);
    expect(w.chamadas.reservou).toBe(0);
  };

  it('família de outra org (ou inexistente) → recusa sem revelar qual dos dois', async () => {
    const w = fakeMundo({ familia: null });
    const r = await dispararMigracaoPxv(w.portas, 'fam-x');
    expect(r).toEqual({ tipo: 'recusado', motivo: 'Produto não encontrado nesta organização.' });
    semEscrita(w);
  });

  it('produto não publicado → recusa', async () => {
    const w = fakeMundo({ familia: { id: 'f', orgId: 'org-1', codigoPai: '1', mlItemId: null, status: null } });
    expect((await dispararMigracaoPxv(w.portas, 'f')).tipo).toBe('recusado');
    semEscrita(w);
  });

  // O pior caso do plano: a RPC de adoção zera `ml_variation_id` da família inteira, inclusive das
  // cores que vivem na partição que continua ativa. O UPDATE seguinte as trataria como novas e
  // duplicaria variações num anúncio real.
  it('produto dividido em N anúncios → recusa explicando o vínculo das outras cores', async () => {
    const w = fakeMundo({
      particoes: [
        { particao: 0, itemExternoId: 'MLB1', migracaoStatus: null },
        { particao: 1, itemExternoId: 'MLB2', migracaoStatus: null },
      ],
    });
    const r = await dispararMigracaoPxv(w.portas, 'fam-1');
    expect(r.tipo).toBe('recusado');
    expect((r as { motivo: string }).motivo).toMatch(/vários anúncios/i);
    semEscrita(w);
  });

  it('sem raiz de partição 0 → recusa (não inventa o registro)', async () => {
    const w = fakeMundo({ particoes: [] });
    expect((await dispararMigracaoPxv(w.portas, 'fam-1')).tipo).toBe('recusado');
    semEscrita(w);
  });

  it('migração já em andamento → recusa', async () => {
    for (const st of ['solicitada', 'em_andamento']) {
      const w = fakeMundo({ particoes: [{ particao: 0, itemExternoId: 'MLB1', migracaoStatus: st }] });
      expect((await dispararMigracaoPxv(w.portas, 'fam-1')).tipo).toBe('recusado');
      semEscrita(w);
    }
  });

  it('raiz apontando para outro anúncio → recusa por incoerência', async () => {
    const w = fakeMundo({ particoes: [{ particao: 0, itemExternoId: 'MLB-OUTRO', migracaoStatus: null }] });
    const r = await dispararMigracaoPxv(w.portas, 'fam-1');
    expect(r.tipo).toBe('recusado');
    expect((r as { motivo: string }).motivo).toMatch(/inconsistente/i);
    semEscrita(w);
  });

  it('família mais nova apontando para outro anúncio → recusa', async () => {
    const w = fakeMundo({ mlItemIdMaisNovo: 'MLB-NOVO' });
    expect((await dispararMigracaoPxv(w.portas, 'fam-1')).tipo).toBe('recusado');
    semEscrita(w);
  });

  it('família publicando agora → recusa', async () => {
    const w = fakeMundo({ algumaPublicando: true });
    expect((await dispararMigracaoPxv(w.portas, 'fam-1')).tipo).toBe('recusado');
    semEscrita(w);
  });

  it('componente de kit virtual → recusa', async () => {
    const w = fakeMundo({ emKitVirtual: true });
    const r = await dispararMigracaoPxv(w.portas, 'fam-1');
    expect((r as { motivo: string }).motivo).toMatch(/Kit Virtual/i);
    semEscrita(w);
  });

  it('ML diz inelegível → recusa repassando as causas', async () => {
    const w = fakeMundo({ elegivel: false, causas: ['Item is not multivariant'] });
    const r = await dispararMigracaoPxv(w.portas, 'fam-1');
    expect((r as { motivo: string }).motivo).toMatch(/not multivariant/);
    expect(w.chamadas.disparou).toBe(0);
  });

  it('snapshot vazio → recusa (sem ele o casamento depois seria por título)', async () => {
    const w = fakeMundo({ snapshot: [] });
    expect((await dispararMigracaoPxv(w.portas, 'fam-1')).tipo).toBe('recusado');
    expect(w.chamadas.disparou).toBe(0);
  });

  // Cor duplicada torna o degrau de casamento por atributo ambíguo. Adotar com chave ambígua é pior
  // que não adotar — o ADR-0105 já exige unicidade de cor pelo mesmo motivo.
  it('duas variações com a mesma cor → recusa antes de migrar', async () => {
    const w = fakeMundo({
      snapshot: [{ id: '1', sku: 'A', cor: 'Azul' }, { id: '2', sku: 'B', cor: 'Azul' }],
    });
    const r = await dispararMigracaoPxv(w.portas, 'fam-1');
    expect((r as { motivo: string }).motivo).toMatch(/mesma cor/i);
    expect(w.chamadas.disparou).toBe(0);
  });

  // Perder a corrida do claim atômico é o caso do clique duplo / dois admins.
  it('reserva perdida (outro disparo simultâneo) → recusa sem chamar o ML', async () => {
    const w = fakeMundo({ reservaOk: false });
    expect((await dispararMigracaoPxv(w.portas, 'fam-1')).tipo).toBe('recusado');
    expect(w.chamadas.disparou).toBe(0);
  });
});

// A idempotência do POST não é documentada pelo ML: "a chamada falhou" NÃO prova "a migração não
// começou". Limpar o estado aqui convidaria o operador a clicar de novo e disparar uma segunda
// migração sobre um item que já pode estar migrando.
describe('dispararMigracaoPxv — falha no POST preserva o estado', () => {
  it('registra a falha, mantém o acompanhamento e devolve falha_ml', async () => {
    const w = fakeMundo({ falharDisparo: 'ML 500: boom' });
    const r = await dispararMigracaoPxv(w.portas, 'fam-1');
    expect(r.tipo).toBe('falha_ml');
    expect(w.chamadas.falhasRegistradas[0]).toMatch(/boom/);
    // Acompanha mesmo assim: se o ML tiver iniciado, o worker descobre e adota.
    expect(w.chamadas.acompanhamentos).toBe(1);
  });
});
