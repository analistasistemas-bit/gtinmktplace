import { describe, it, expect } from 'vitest';
import { avisarFimTransferencia, avisarFinsPendentes, linkGerenciarKit } from '../aviso-fim.ts';

// ADR-0200 (adendo 08/11): aviso de fim de montagem/desmontagem/reposição. Envio com chave por transferência e marca
// gravada só depois do sucesso: retry não duplica, falha fica para a varredura.

type Linha = Record<string, unknown>;

/** Banco em memória: filtros eq/in/is aplicados de verdade; `update` muda as linhas que casam. */
function banco(tabelas: Record<string, Linha[]>) {
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let patch: Linha | null = null;
    let lim = Infinity;
    const linhas = () => (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q, order: () => q,
      limit: (n: number) => { lim = n; return q; },
      update: (p: Linha) => { patch = p; return q; },
      eq: (k: string, v: unknown) => { filtros.push((l) => l[k] === v); return q; },
      in: (k: string, v: unknown[]) => { filtros.push((l) => v.includes(l[k])); return q; },
      is: (k: string, v: unknown) => { filtros.push((l) => (l[k] ?? null) === v); return q; },
      not: (k: string, _op: string, v: unknown) => { filtros.push((l) => (l[k] ?? null) !== v); return q; },
      maybeSingle: () => Promise.resolve({ data: linhas()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        if (patch) {
          for (const l of linhas()) Object.assign(l, patch);
          return Promise.resolve({ error: null }).then(res);
        }
        return Promise.resolve({ data: linhas().slice(0, lim), error: null }).then(res);
      },
    };
    return q;
  };
  return { admin: { from } as never, tabelas };
}

function cenario(o: { tipo?: string; estado?: string; criar?: boolean; permalinkFamilia?: string | null } = {}) {
  return banco({
    kit_transferencias: [{
      id: 't1', org_id: 'org-1', kit_id: 'k1', tipo: o.tipo ?? 'montar', estado: o.estado ?? 'concluida',
      alerta: 'quarentena', aviso_fim_enviado_em: null,
      itens: [{ codigo: 'KIT-AP-M', quantidade: 3 }, { codigo: 'KIT-AP-G', quantidade: 1 }],
    }],
    kits_variacao: [{ id: 'k1', org_id: 'org-1', codigo_pai_kit: '00000223', codigo_pai_base: '00000100', pecas_por_kit: 2 }],
    kit_variacao_skus: [
      { kit_id: 'k1', org_id: 'org-1', codigo: 'KIT-AP-M', rotulo_cor: 'Azul + Preto', tamanho: 'M' },
      { kit_id: 'k1', org_id: 'org-1', codigo: 'KIT-AP-G', rotulo_cor: 'Azul + Preto', tamanho: 'G' },
    ],
    kit_transferencia_alvos: [{ transferencia_id: 't1', org_id: 'org-1', codigo: 'KIT-AP-M', criar: o.criar ?? false }],
    familias: [{
      org_id: 'org-1', codigo_pai: '00000223', nome_pai: 'Kit 2 Camisetas Básicas',
      ml_permalink: o.permalinkFamilia === undefined ? 'https://produto.mercadolivre.com.br/MLB-1' : o.permalinkFamilia,
    }],
    anuncios_externos_itens: [{ org_id: 'org-1', sku: 'KIT-AP-M', permalink: 'https://produto.mercadolivre.com.br/MLB-2' }],
  });
}

function notificador(falhar = () => false) {
  const enviados: Array<{ categoria: string; texto: string; chave: string }> = [];
  const notificar = async (_a: unknown, _o: string, categoria: string, texto: string, op: { chave: string }) => {
    if (falhar()) throw new Error('telegram fora');
    enviados.push({ categoria, texto, chave: op.chave });
    return 1;
  };
  return { enviados, notificar: notificar as never };
}

describe('avisarFimTransferencia', () => {
  it('montagem concluída avisa uma vez com kit, combinações, tamanhos, quantidade e URL', async () => {
    const b = cenario();
    const n = notificador();
    expect(await avisarFimTransferencia(b.admin, n.notificar, 'org-1', 't1')).toBe(true);
    expect(n.enviados).toHaveLength(1);
    const { texto, chave, categoria } = n.enviados[0];
    expect(categoria).toBe('estoque');
    expect(chave).toBe('kit_fim:t1');
    expect(texto).toContain('Kit 2 Camisetas Básicas');
    expect(texto).toContain('00000223');
    expect(texto).toMatch(/Azul \+ Preto · M: 3 kits/);
    expect(texto).toMatch(/Azul \+ Preto · G: 1 kit\b/);
    expect(texto).toMatch(/4 kits/);
    expect(texto).toContain('https://produto.mercadolivre.com.br/MLB-1');
    expect(texto).toMatch(/seletor de combinação/);
    // `alerta` fica com motivo velho de reagendamento (coalesce): nunca vai no aviso de concluída.
    expect(texto).not.toContain('quarentena');
    expect(b.tabelas.kit_transferencias[0].aviso_fim_enviado_em).not.toBeNull();

    // Retry (reentrega, varredura): já marcado, não envia de novo.
    expect(await avisarFimTransferencia(b.admin, n.notificar, 'org-1', 't1')).toBe(false);
    expect(n.enviados).toHaveLength(1);
  });

  it('falha no envio não marca: a próxima tentativa envia com a mesma chave', async () => {
    const b = cenario();
    let falhar = true;
    const n = notificador(() => falhar);
    await expect(avisarFimTransferencia(b.admin, n.notificar, 'org-1', 't1')).rejects.toThrow('telegram fora');
    expect(b.tabelas.kit_transferencias[0].aviso_fim_enviado_em).toBeNull();
    falhar = false;
    expect(await avisarFimTransferencia(b.admin, n.notificar, 'org-1', 't1')).toBe(true);
    expect(n.enviados.map((e) => e.chave)).toEqual(['kit_fim:t1']);
  });

  it('criação diz "Kit criado"; sem permalink na família usa o do item', async () => {
    const b = cenario({ criar: true, permalinkFamilia: null });
    const n = notificador();
    await avisarFimTransferencia(b.admin, n.notificar, 'org-1', 't1');
    expect(n.enviados[0].texto).toMatch(/Kit criado/);
    expect(n.enviados[0].texto).toContain('MLB-2');
  });

  it('desmontagem e reposição também avisam; sem seletor na desmontagem', async () => {
    for (const tipo of ['desmontar', 'repor']) {
      const b = cenario({ tipo });
      const n = notificador();
      expect(await avisarFimTransferencia(b.admin, n.notificar, 'org-1', 't1')).toBe(true);
      expect(n.enviados[0].texto).toMatch(tipo === 'desmontar' ? /Kit desmontado/ : /Kit reposto/);
      if (tipo === 'desmontar') expect(n.enviados[0].texto).not.toMatch(/seletor/);
    }
  });

  it('ativa, travada, abortada e tipos fora do escopo não avisam', async () => {
    for (const o of [{ estado: 'ativa' }, { estado: 'travada' }, { estado: 'abortada' }, { tipo: 'entrada' }, { tipo: 'cancelamento' }]) {
      const b = cenario(o);
      const n = notificador();
      expect(await avisarFimTransferencia(b.admin, n.notificar, 'org-1', 't1')).toBe(false);
      expect(n.enviados).toHaveLength(0);
    }
  });
});

describe('avisarFinsPendentes', () => {
  it('varredura reenvia só o que ficou sem marca e não derruba as demais por erro', async () => {
    const b = cenario();
    b.tabelas.kit_transferencias.push({ ...b.tabelas.kit_transferencias[0], id: 't2', kit_id: 'sumiu' });
    b.tabelas.kit_transferencias.push({ ...b.tabelas.kit_transferencias[0], id: 't3', aviso_fim_enviado_em: '2026-11-08T00:00:00Z' });
    const n = notificador();
    expect(await avisarFinsPendentes(b.admin, n.notificar)).toBe(1);
    expect(n.enviados.map((e) => e.chave)).toEqual(['kit_fim:t1']);
  });
});

describe('linkGerenciarKit', () => {
  it('monta o link do Gerenciar kit e some sem APP_URL ou sem kit', () => {
    expect(linkGerenciarKit('https://app.publiai.com.br/', 'k1')).toBe('https://app.publiai.com.br/#/publicados?kit=k1');
    expect(linkGerenciarKit('', 'k1')).toBeNull();
    expect(linkGerenciarKit(undefined, 'k1')).toBeNull();
    expect(linkGerenciarKit('https://x', null)).toBeNull();
  });
});
