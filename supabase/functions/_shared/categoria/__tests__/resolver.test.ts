import { describe, it, expect } from 'vitest';
import { resolverCategoria, type DepsResolver } from '../resolver';
import type { CategoriaCandidata } from '../../ml/domain-discovery';

const furadeira: CategoriaCandidata[] = [
  { domainId: 'MLB-ELECTRIC_DRILLS', domainName: 'Furadeiras elétricas', categoriaId: 'MLB189007', categoriaNome: 'De Mão' },
  { domainId: 'MLB-HAMMER_DRILLS', domainName: 'Furadeiras', categoriaId: 'MLB430376', categoriaNome: 'Marteletes' },
];
const caderno: CategoriaCandidata[] = [
  { domainId: 'MLB-NOTEBOOKS_AND_WRITING_PADS', domainName: 'Cadernos', categoriaId: 'MLB105305', categoriaNome: 'Cadernos' },
];
const furadeiraComTopoRuim: CategoriaCandidata[] = [
  { domainId: 'MLB-NETWORK_GATEWAYS', domainName: 'Adaptadores e Gateways', categoriaId: 'MLB11400', categoriaNome: 'Adaptadores e Gateways' },
  { domainId: 'MLB-ELECTRIC_DRILLS', domainName: 'Furadeiras elétricas', categoriaId: 'MLB189007', categoriaNome: 'De Mão' },
];
const furadeiraSemCandidatoCompativel: CategoriaCandidata[] = [
  { domainId: 'MLB-NETWORK_GATEWAYS', domainName: 'Adaptadores e Gateways', categoriaId: 'MLB11400', categoriaNome: 'Adaptadores e Gateways' },
];

const deps = (candidatos: CategoriaCandidata[], llm?: DepsResolver['llm']): DepsResolver => ({
  preditor: async () => candidatos,
  llm,
});

describe('resolverCategoria', () => {
  it('(a) override casa → regex, sem chamar o preditor', async () => {
    let chamou = false;
    const r = await resolverCategoria({ nome: 'FITA CETIM PROGRESSO N.3 10MT' }, {
      preditor: async () => { chamou = true; return []; },
    });
    expect(r.origem).toBe('regex');
    expect(r.categoriaId).toBe('MLB255054');
    expect(r.tipo).toBe('fita');
    expect(chamou).toBe(false);
  });

  it('(b) sem override, preditor 1 domain → preditor (topo)', async () => {
    const r = await resolverCategoria({ nome: 'Caderno universitário 10 matérias' }, deps(caderno));
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB105305');
    expect(r.categoriaNome).toBe('Cadernos');
    expect(r.tipo).toBe('outro');
  });

  it('(c) sem override, ≥2 domains + llm escolhe candidato ≠ topo → ia', async () => {
    const r = await resolverCategoria({ nome: 'Martelete demolidor' }, deps(furadeira, async () => 'MLB430376'));
    expect(r.origem).toBe('ia');
    expect(r.categoriaId).toBe('MLB430376');
  });

  it('(d) llm devolve id fora da lista → topo (preditor)', async () => {
    const r = await resolverCategoria({ nome: 'Furadeira' }, deps(furadeira, async () => 'MLB999999'));
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB189007');
  });

  it('(e) preditor [] → manual/outro', async () => {
    const r = await resolverCategoria({ nome: 'Produto inexistente xyz' }, deps([]));
    expect(r.origem).toBe('manual');
    expect(r.categoriaId).toBeNull();
    expect(r.tipo).toBe('outro');
  });

  it('(f) ambíguo mas sem deps.llm → topo (preditor)', async () => {
    const r = await resolverCategoria({ nome: 'Furadeira' }, deps(furadeira));
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB189007');
  });

  it('(g) llm escolhe o próprio topo → permanece preditor', async () => {
    const r = await resolverCategoria({ nome: 'Furadeira' }, deps(furadeira, async () => 'MLB189007'));
    expect(r.origem).toBe('preditor');
  });

  it('(h) preditor lança → manual (resiliente)', async () => {
    const r = await resolverCategoria({ nome: 'Algo' }, { preditor: async () => { throw new Error('rede'); } });
    expect(r.origem).toBe('manual');
  });

  it('(i) pista forte no título corrige topo semanticamente incompatível', async () => {
    const r = await resolverCategoria(
      { nome: 'AUDITORIA E1E4 FURADEIRA 650W BIVOLT' },
      deps(furadeiraComTopoRuim),
    );
    expect(r.categoriaId).toBe('MLB189007');
    expect(r.categoriaNome).toBe('De Mão');
  });

  it('(j) pista forte sem candidato compatível → manual (não inventa categoria, operador decide)', async () => {
    const r = await resolverCategoria(
      { nome: 'AUDITORIA REVALIDACAO FURADEIRA 650W BIVOLT' },
      deps(furadeiraSemCandidatoCompativel),
    );
    expect(r.origem).toBe('manual');
    expect(r.categoriaId).toBeNull();
    expect(r.tipo).toBe('outro');
  });

  it('(k) preditor devolve categoria de aviamento conhecida → deriva o tipo (não fica "outro")', async () => {
    // Nome que a regex NÃO cobre, mas o preditor do ML manda p/ Fios e Cadarços (MLB270273).
    // Sem derivar o tipo, ficaria 'outro' e os obrigatórios BRAND/MODEL nunca seriam montados.
    const fiosCat: CategoriaCandidata[] = [
      { domainId: 'MLB-YARNS', domainName: 'Fios e Cadarços', categoriaId: 'MLB270273', categoriaNome: 'Fios e Cadarços de Armarinho' },
    ];
    const r = await resolverCategoria({ nome: 'NOVELO CRU ALGODAO 100G' }, deps(fiosCat));
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB270273');
    expect(r.tipo).toBe('linha');
  });
});

describe('resolverCategoria — tipo_produto_busca + candidatos genéricos + abstenção (ADR-0054)', () => {
  const generico: CategoriaCandidata = { domainId: 'MLB-ARTS_AND_CRAFTS', domainName: 'Artes e artesanatos', categoriaId: 'MLB1371', categoriaNome: 'Outros' };
  const fiosCat: CategoriaCandidata = { domainId: 'MLB-SEWING_AND_CRAFT_THREADS', domainName: 'Fios para costura', categoriaId: 'MLB270273', categoriaNome: 'Fios e Cadarços de Armarinho' };

  it('(l) só candidato genérico ("Outros") → aplica como fallback visível (ADR-0058), não trava mais', async () => {
    const r = await resolverCategoria(
      { nome: 'BAINHA INSTANTÂNEA 4MT UND' },
      { preditor: async () => [generico] },
    );
    expect(r.origem).toBe('generico');
    expect(r.categoriaId).toBe('MLB1371');
    expect(r.categoriaNome).toBe('Outros');
    expect(r.tipo).toBe('outro');
  });

  it('(m) busca bruta falha, tipoProdutoBusca acha candidato específico bom → resolve', async () => {
    const r = await resolverCategoria(
      { nome: 'EUROROMA 4/6 CORES 600G 610MT', tipoProdutoBusca: 'barbante de crochê' },
      {
        preditor: async (q) => (q === 'barbante de crochê' ? [fiosCat] : []),
      },
    );
    expect(r.categoriaId).toBe('MLB270273');
    expect(r.tipo).toBe('linha');
  });

  it('(n) LLM abstém deliberadamente (null) mesmo com 1 candidato específico → manual, não aceita o falso-amigo', async () => {
    const especifico: CategoriaCandidata = { domainId: 'MLB-BICYCLE_TIRE_REPAIR_KITS', domainName: 'Kit de remendos de bicicletas', categoriaId: 'MLB67966', categoriaNome: 'Remendos' };
    const r = await resolverCategoria(
      { nome: 'REMENDO MAGICO 1MT UND' },
      { preditor: async () => [especifico], llm: async () => null },
    );
    expect(r.origem).toBe('manual');
    expect(r.categoriaId).toBeNull();
  });

  it('(n2) LLM abstém do específico (falso-amigo) MAS há genérico do segmento na lista → cai no genérico, não em manual (ADR-0058, caso real "BAINHA" lote 51)', async () => {
    // Reprodução exata do caso real: domain_discovery pra "bainha" devolve o genérico correto
    // do segmento (Artes e artesanatos → Outros, MLB1371) JUNTO com um específico falso-amigo
    // (Bainhas para Facas). O LLM corretamente recusa o específico; antes disso virava 'manual'
    // e descartava o genérico correto que já estava na lista. Agora resgata o genérico.
    const especificoFalsoAmigo: CategoriaCandidata = { domainId: 'MLB-KNIFE_SHEATHS', domainName: 'Bainhas para facas', categoriaId: 'MLB433161', categoriaNome: 'Bainhas para Facas' };
    const r = await resolverCategoria(
      { nome: 'BAINHA INSTANTÂNEA 4MT UND' },
      { preditor: async () => [generico, especificoFalsoAmigo], llm: async () => null },
    );
    expect(r.origem).toBe('generico');
    expect(r.categoriaId).toBe('MLB1371');
    expect(r.categoriaNome).toBe('Outros');
  });

  it('(n3) pista forte sem candidato compatível MAS há genérico na lista → cai no genérico, não em manual', async () => {
    const furadeiraSemCandidatoMasComGenerico: CategoriaCandidata[] = [
      { domainId: 'MLB-NETWORK_GATEWAYS', domainName: 'Adaptadores e Gateways', categoriaId: 'MLB11400', categoriaNome: 'Adaptadores e Gateways' },
      { domainId: 'MLB-TOOLS_MISC', domainName: 'Ferramentas diversas', categoriaId: 'MLB999001', categoriaNome: 'Outros' },
    ];
    const r = await resolverCategoria(
      { nome: 'AUDITORIA REVALIDACAO FURADEIRA 650W BIVOLT' },
      { preditor: async () => furadeiraSemCandidatoMasComGenerico },
    );
    expect(r.origem).toBe('generico');
    expect(r.categoriaId).toBe('MLB999001');
  });

  it('(o) LLM falha tecnicamente (undefined) → cai no topo específico (resiliente, como hoje)', async () => {
    const especifico: CategoriaCandidata = { domainId: 'MLB-X', domainName: 'X', categoriaId: 'MLB1', categoriaNome: 'Categoria Específica' };
    const r = await resolverCategoria(
      { nome: 'Produto qualquer' },
      { preditor: async () => [especifico], llm: async () => undefined },
    );
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB1');
  });

  it('(p) mistura genérico + específico: LLM só vê o específico e escolhe', async () => {
    const r = await resolverCategoria(
      { nome: 'X' },
      { preditor: async () => [generico, fiosCat], llm: async (_i, cands) => {
          expect(cands.some((c) => c.categoriaNome === 'Outros')).toBe(false);
          return 'MLB270273';
        } },
    );
    expect(r.categoriaId).toBe('MLB270273');
  });

  it('(q) tipoProdutoBusca vazio → só 1 chamada ao preditor (sem 2ª busca desnecessária)', async () => {
    let chamadas = 0;
    await resolverCategoria(
      { nome: 'Caderno', tipoProdutoBusca: '' },
      { preditor: async () => { chamadas++; return []; } },
    );
    expect(chamadas).toBe(1);
  });

  it('(r) dedup: mesmo category_id nas duas buscas não duplica candidato', async () => {
    const r = await resolverCategoria(
      { nome: 'EUROROMA', tipoProdutoBusca: 'linha euroroma' },
      { preditor: async () => [fiosCat] },
    );
    expect(r.categoriaId).toBe('MLB270273');
    expect(r.origem).toBe('preditor');
  });
});
