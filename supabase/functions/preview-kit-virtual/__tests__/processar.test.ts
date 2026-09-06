// ADR-0154 (Kit Virtual) — Task 6. Vitest (não Deno test), mesmo runner de
// buscar-componentes-kit-virtual/__tests__/processar.test.ts.
import { describe, it, expect, vi } from 'vitest';
import {
  gerarTituloKit, montarPreviewKit, LIMITE_TITULO_KIT,
  type ComponenteEntrada, type PreviewKitDeps, type PreviewKitInput,
} from '../processar.ts';

function componente(p: Partial<ComponenteEntrada> & { ordem: number }): ComponenteEntrada {
  return {
    userProductId: `UP-${p.ordem}`,
    quantidade: 1,
    precoAtualML: 100,
    custo: 10,
    origem: 'nacional',
    titulo: `Produto ${p.ordem}`,
    kitMultiplicador: null,
    ...p,
  };
}

function deps(p: Partial<PreviewKitDeps> = {}): PreviewKitDeps {
  return {
    buscarComissao: async () => ({ percentual: 12, fixa: 0 }),
    lerAliquotasOrg: async () => ({ nacional: 8, importado: 16 }),
    ...p,
  };
}

function input(p: Partial<PreviewKitInput> = {}): PreviewKitInput {
  return {
    componentes: [componente({ ordem: 0 }), componente({ ordem: 1 })],
    descontoPct: 0.1,
    categoriaMlIdPrincipal: 'MLB1234',
    gerarDescricao: false,
    ...p,
  };
}

describe('gerarTituloKit — template determinístico (Decisão 4)', () => {
  it('monta "Kit N itens: A + B" para 2 componentes curtos, respeitando a ordem', () => {
    const titulo = gerarTituloKit([
      { ordem: 1, titulo: 'Garfo', quantidade: 1 },
      { ordem: 0, titulo: 'Faca', quantidade: 1 },
    ]);
    expect(titulo).toBe('Kit 2 itens: 1 Faca + 1 Garfo');
  });

  it('monta o título para 6 componentes (limite superior do ML) — com títulos reais, o guard trunca', () => {
    const componentes = Array.from({ length: 6 }, (_, i) => ({ ordem: i, titulo: `Produto ${i}`, quantidade: 1 }));
    const titulo = gerarTituloKit(componentes);
    expect(titulo.startsWith('Kit 6 itens: 1 Produto 0')).toBe(true);
    expect(titulo.length).toBeLessThanOrEqual(LIMITE_TITULO_KIT);
  });

  // Medido no kit real MLB5194783047 (2026-09-06): o ML NÃO expande o family_name — devolve o
  // título como veio, só capitalizado. Logo o que for truncado aqui é o que fica no anúncio, e
  // cortar no meio de uma palavra é defeito publicado (o primeiro kit saiu "... - Me", de "Melu").
  it('guard de tamanho: trunca na última palavra inteira, sem cortar palavra ao meio', () => {
    const componentes = [
      { ordem: 0, titulo: 'Motosserra Elétrica Profissional 2200w 16 Polegadas Gasolina', quantidade: 1 },
      { ordem: 1, titulo: 'Canivete Retrátil Multifuncional Aço Inox Premium', quantidade: 2 },
    ];
    const titulo = gerarTituloKit(componentes);
    expect(titulo.length).toBeLessThanOrEqual(LIMITE_TITULO_KIT);
    // nenhuma palavra partida: o título truncado é prefixo do template por palavras inteiras
    const completo = 'Kit 2 itens: 1 Motosserra Elétrica Profissional 2200w 16 Polegadas Gasolina + 2 Canivete Retrátil Multifuncional Aço Inox Premium';
    expect(completo.startsWith(titulo)).toBe(true);
    expect(completo[titulo.length] === ' ' || completo.length === titulo.length).toBe(true);
    expect(titulo.endsWith('…')).toBe(false);
  });

  it('usa o teto real do ML (60), não a folga antiga de 40', () => {
    expect(LIMITE_TITULO_KIT).toBe(60);
  });

  // Visto no preview real: cortar por palavra resolvia a palavra partida mas deixava o começo
  // órfão do próximo componente pendurado — "...We'be 200ml + 1" —, e isso ia para o anúncio.
  it('não deixa separador nem quantidade órfã do componente seguinte', () => {
    const titulo = gerarTituloKit([
      { ordem: 0, titulo: "Body Splash Liberty White We'be 200ml", quantidade: 1 },
      { ordem: 1, titulo: 'Hidratante Corporal E Facial Better Me Para Pele Pitaya 150g', quantidade: 1 },
    ]);
    expect(titulo).toBe("Kit 2 itens: 1 Body Splash Liberty White We'be 200ml");
    expect(/[+\-\s]$/.test(titulo)).toBe(false);
    expect(/\+\s*\d*$/.test(titulo)).toBe(false);
  });

  it('não trunca quando o template cabe dentro do limite', () => {
    const titulo = gerarTituloKit([{ ordem: 0, titulo: 'A', quantidade: 1 }, { ordem: 1, titulo: 'B', quantidade: 1 }]);
    expect(titulo.length).toBeLessThanOrEqual(LIMITE_TITULO_KIT);
    expect(titulo.endsWith('…')).toBe(false);
  });
});

describe('montarPreviewKit — margem (Decisão 6/7)', () => {
  it('repassa {ok:false, faltando} intacto quando falta custo — nunca vira 0/null/""', async () => {
    const resultado = await montarPreviewKit(deps(), input({
      componentes: [
        componente({ ordem: 0, custo: 10 }),
        componente({ ordem: 1, custo: null }),
      ],
    }));
    expect(resultado.margem).toEqual({ ok: false, faltando: [{ ordem: 1, campo: 'custo' }] });
  });

  it('repassa {ok:false} quando alíquotas da org não estão confirmadas', async () => {
    const resultado = await montarPreviewKit(
      deps({ lerAliquotasOrg: async () => null }),
      input(),
    );
    expect(resultado.margem.ok).toBe(false);
    if (resultado.margem.ok) return;
    expect(resultado.margem.faltando).toContainEqual({ ordem: -1, campo: 'aliquotas' });
  });

  it('calcula margem de kit misto nacional + importado (imposto por componente, Decisão 7)', async () => {
    const resultado = await montarPreviewKit(deps(), input({
      componentes: [
        componente({ ordem: 0, precoAtualML: 100, custo: 40, origem: 'nacional' }),
        componente({ ordem: 1, precoAtualML: 100, custo: 40, origem: 'importado' }),
      ],
      descontoPct: 0,
    }));
    expect(resultado.margem.ok).toBe(true);
    if (!resultado.margem.ok) return;
    // nacional: 100 × 8% = 8; importado: 100 × 16% = 16 → impostoTotal 24 (nunca uma só alíquota pro kit inteiro).
    expect(resultado.margem.impostoTotal).toBe(24);
    expect(resultado.margem.precoKit).toBe(200);
  });

  it('margemEstimativa sempre true (Decisão 15 — rótulo obrigatório)', async () => {
    const resultado = await montarPreviewKit(deps(), input());
    expect(resultado.margemEstimativa).toBe(true);
  });
});

describe('montarPreviewKit — aviso de kit vinculado (Decisão 9)', () => {
  it('sinaliza aviso quando algum componente tem kit_multiplicador', async () => {
    const resultado = await montarPreviewKit(deps(), input({
      componentes: [
        componente({ ordem: 0 }),
        componente({ ordem: 1, kitMultiplicador: 3 }),
      ],
    }));
    expect(resultado.avisoKitVinculado).toBe(true);
  });

  it('sem aviso quando nenhum componente é kit vinculado', async () => {
    const resultado = await montarPreviewKit(deps(), input());
    expect(resultado.avisoKitVinculado).toBe(false);
  });
});

describe('montarPreviewKit — descrição por IA só sob pedido (Decisão 4)', () => {
  it('NÃO chama gerarDescricaoKit quando gerar_descricao é false (caminho quente de recalcular desconto)', async () => {
    const gerarDescricaoKit = vi.fn(async () => 'nunca deveria rodar');
    const resultado = await montarPreviewKit(deps({ gerarDescricaoKit }), input({ gerarDescricao: false }));
    expect(gerarDescricaoKit).not.toHaveBeenCalled();
    expect(resultado.descricao).toBeNull();
    expect(resultado.descricaoGeradaPorIA).toBe(false);
  });

  it('chama gerarDescricaoKit quando gerar_descricao é true', async () => {
    const gerarDescricaoKit = vi.fn(async () => 'Kit com dois produtos excelentes.');
    const resultado = await montarPreviewKit(deps({ gerarDescricaoKit }), input({ gerarDescricao: true }));
    expect(gerarDescricaoKit).toHaveBeenCalledTimes(1);
    expect(resultado.descricao).toBe('Kit com dois produtos excelentes.');
    expect(resultado.descricaoGeradaPorIA).toBe(true);
  });

  it('lança erro claro se gerar_descricao=true mas a dep não foi injetada', async () => {
    await expect(montarPreviewKit(deps({ gerarDescricaoKit: undefined }), input({ gerarDescricao: true })))
      .rejects.toThrow(/gerarDescricaoKit/);
  });
});
