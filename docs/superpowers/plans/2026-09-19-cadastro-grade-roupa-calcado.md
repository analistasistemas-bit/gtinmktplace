# Cadastro em grade (roupa / calçado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a roupa/calçado uma tela de cadastro própria — grade cor × tamanho com preço/custo/dimensão preenchidos uma vez e herdados por linha — devolvendo o dialog de cadastro normal ao formato simples de antes do ADR-0166.

**Architecture:** Duas telas fisicamente separadas. A lógica cara do dialog atual (upload de fotos em lote com casamento posicional, retry, 409, `chaveCadastro`, sugestão de NCM, etapa 2 de fotos) é extraída primeiro para um hook `useCadastroProduto()` + componente `EtapaFotos` usados pelos DOIS dialogs — sem isso o dialog novo duplicaria ~500 linhas. A grade em si é derivada de duas funções puras testáveis isoladamente: `reconciliarGrade()` (quais combinações entram/saem a cada clique) e `resolverLinha()` (valor efetivo de cada campo = override da linha, senão cabeçalho). Backend intocado: o payload que sai para a edge `cadastrar-produto` é campo a campo idêntico ao de hoje.

**Tech Stack:** React 19 + TypeScript, Vite, vitest + @testing-library/react + userEvent, TanStack Query, shadcn/ui (Dialog, AlertDialog, Checkbox, Badge), Tailwind v4. Backend: Supabase Edge Functions (Deno) — **não alterado nesta entrega**.

**Spec:** `docs/superpowers/specs/2026-09-19-cadastro-grade-roupa-calcado-design.md` (design aprovado, revisado por Codex GPT-6-Astra e por Fable). O plano argumenta a partir dela; o executor lê as duas.

## Global Constraints

- **Nenhuma migration, nenhuma coluna nova, nenhuma mudança de contrato da edge.** O payload de `cadastrarProduto()` sai campo a campo idêntico ao de hoje (spec §4). Se um teste da edge precisar mudar de forma, algo saiu do escopo — parar e perguntar.
- **Nunca inventar dado de produto** (CLAUDE.md). A tabela de comprimento de pé e as listas de tamanho vêm da fonte única do backend, nunca redigitadas no frontend (precedente R7 do ADR-0166).
- **Herança é só front-end.** Nenhuma linha vai para o banco com "herdado": o valor efetivo é resolvido antes de montar o payload.
- **Casamento posicional linha ↔ resposta da edge é sagrado** (`dialog-cadastro-produto.tsx:362-376`): a lista de linhas fica CONGELADA durante `salvando` nos dois dialogs.
- **`genero` continua no payload sempre**, inclusive no dialog revertido (que passa `null`). Não remover o campo de `ProdutoEntrada` nem de `montarPayload` — o dialog de grade depende dele.
- Limite de 60 combinações (`LIMITE_VARIACOES_GERADAS`, `src/lib/tamanhos.ts:35`) continua valendo, sem mudança de valor.
- Rótulo do campo de preço é exatamente **"Preço mínimo (líquido)"** (`linha-variacao-form.tsx:58`), nunca "Preço".
- Nome de linha na UI é sempre **"Cor · Tamanho"** (ex.: `Azul · M`), nunca "Variação 7".
- Comandos: teste de um arquivo é `pnpm test <caminho>` (passa direto para `vitest run`). Portão de pré-push é `pnpm preflight:static` (~27s) — nunca remontar o checklist à mão.
- Roteamento de modelo por task está anotado em cada uma (**Modelo:**). Não existe migration nem RLS nesta feature, então a trava de "nunca rebaixar modelo" não se aplica; `haiku` não é usado em nenhuma task (nenhuma é mecânica auto-verificável sem reconferência).

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/components/estoque/use-cadastro-produto.ts` (**novo**) | Hook com todo o ciclo de vida do cadastro (chave idempotente, salvar, upload em lote, retry, 409, confirmação de fechar) + `montarPayload` compartilhado | 1 |
| `src/components/estoque/etapa-fotos.tsx` (**novo**) | Etapa 2 (fotos) compartilhada pelos dois dialogs | 1 |
| `src/components/estoque/dialog-cadastro-produto.tsx` | Cadastro normal — consome o hook; **revertido** ao formato de antes do ADR-0166 | 1, 2 |
| `src/lib/cadastro-grade.ts` (**novo**) | Funções puras da grade: `chaveGrade`, `totalDaGrade`, `reconciliarGrade`, `resolverLinha` + tipos | 3, 4 |
| `supabase/functions/_shared/ml/medidas-valores.ts` (**novo**) | Módulo folha (zero imports) com `COMPRIMENTO_PE_CM`, para o Vite conseguir importar | 5 |
| `src/lib/tamanhos.ts` | Listas + `opcoesDeTamanho` + `LIMITE_VARIACOES_GERADAS` + `numeracaoPublicavel`; perde `gerarCombinacoes`/`contarCombinacoes` | 5, 6, 11 |
| `src/components/estoque/gerador-variacoes.tsx` | UI de chips/checkboxes, **controlada** (sem botão "Gerar") | 6 |
| `src/components/estoque/linha-grade-form.tsx` (**novo**) | Linha compacta da grade, cor/tamanho travados, cadeado por campo | 7 |
| `src/components/estoque/dialog-cadastro-grade.tsx` (**novo**) | O dialog novo: passos 0–3, fiscal, salvar, fotos | 8, 9 |
| `src/pages/Estoque.tsx` | Segundo botão "Cadastrar com grade" | 10 |
| `src/lib/tipos-produto.ts`, `supabase/functions/_shared/produto/tipos-produto-valores.ts` | Remoção do Tamanho Único | 11 |
| `docs/decisions/0166-tipo-de-produto-por-organizacao.md` | Nota de amendment | 12 |

---

## Task 1: Extrair `useCadastroProduto()` + `EtapaFotos` + `montarPayload`

**Modelo:** `sonnet`. É a task mais arriscada do plano, mas a correção é **inteiramente determinada** pela suíte existente de 900 linhas — nenhum julgamento arquitetural novo é pedido, só mover código sem mudar comportamento. Isso é auto-verificável, que é o critério do CLAUDE.md para não escalar. **Restrição dura:** nenhuma mudança de comportamento; **todos os testes de `dialog-cadastro-produto.test.tsx` passam sem uma única edição, antes e depois.** Se o executor precisar editar um teste nesta task, ele quebrou a extração — parar e reportar.

**Files:**
- Create: `src/components/estoque/use-cadastro-produto.ts`
- Create: `src/components/estoque/etapa-fotos.tsx`
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx` (remove as ~500 linhas extraídas e passa a consumir o hook)
- Test (rede de segurança, **não editar**): `src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `useCadastroProduto({ aberto, onCadastrado }): CadastroProdutoApi`
  - `montarPayload(pai, linhas, chaveCadastro, fiscal?): ProdutoEntrada` — agora **exportado**, com `pai.genero: 'masculino' | 'feminino' | 'unissex' | null`
  - `CAMPOS_NUMERICOS`, `numOuNull`
  - `<EtapaFotos api resultado fotosCapa onEscolherCapa arquivoPorIndice onPatchFotoLinha />`
  - tipos `FotosDoCadastro`, `AlvoFoto`, `CadastroProdutoApi`

- [ ] **Step 1: Rodar a suíte inteira ANTES de tocar em nada, e guardar o número**

Run: `pnpm test src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx`
Expected: PASS, todos verdes. Anotar a contagem exata de testes — ela tem que ser idêntica no fim da task.

- [ ] **Step 2: Criar `src/components/estoque/use-cadastro-produto.ts` com o payload e as constantes numéricas**

Mover, sem alterar uma linha da lógica, `CAMPOS_NUMERICOS`, `numOuNull` e `montarPayload` de `dialog-cadastro-produto.tsx:51-120`. Cabeçalho novo do arquivo:

```ts
// Lógica de cadastro compartilhada pelos DOIS dialogs (cadastro normal e cadastro em grade).
// Extraída de dialog-cadastro-produto.tsx sem mudança de comportamento: os ~500 linhas de
// upload em lote / retry / 409 / chave idempotente eram closures internas do componente e não
// dava para reaproveitá-las sem duplicar. Os testes de dialog-cadastro-produto.test.tsx (900
// linhas) são a rede de segurança dessa extração.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';
import { effectiveOrgId, useSupportStore, canWrite } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import {
  cadastrarProduto, uploadFotoProduto, ProdutoJaExisteError, CadastroResultadoAmbiguoError,
  type ResultadoCadastro,
} from '@/lib/produtos-saldo';
import type { ProdutoEntrada, VariacaoEntrada } from '@/lib/produto-entrada';
import { parseNum, type LinhaVariacao } from '@/components/estoque/linha-variacao-form';
import type { FiscalForm } from '@/components/estoque/etapa-fiscal-form';

export type AlvoFoto = Parameters<typeof uploadFotoProduto>[3];

// Todo campo numérico que `erroCampo` valida — usado pelo gate `podeSalvar` para travar o
// submit se QUALQUER um, em QUALQUER linha, tiver erro (não só `preco`).
export const CAMPOS_NUMERICOS = [
  'preco', 'custo', 'estoqueInicial', 'pesoGramas', 'alturaCm', 'larguraCm', 'comprimentoCm',
] as const;

// Normaliza `NaN` (texto inválido) para `null`. `podeSalvar` já garante que nenhum campo
// numérico de nenhuma linha tem erro antes de chegar aqui — NaN não deveria ocorrer; isto é
// só uma conversão defensiva de tipo, não a validação em si.
export function numOuNull(v: string): number | null {
  const n = parseNum(v);
  return typeof n === 'number' && !Number.isNaN(n) ? n : null;
}

export function montarPayload(
  pai: {
    nomePai: string; descricaoPai: string; unidade: string; fornecedor: string;
    origem: 'nacional' | 'importado';
    genero: 'masculino' | 'feminino' | 'unissex' | null;
  },
  linhas: LinhaVariacao[],
  chaveCadastro: string,
  fiscal?: FiscalForm,
): ProdutoEntrada {
  const variacoes: VariacaoEntrada[] = linhas.map((l) => ({
    nome: l.nome.trim() || null,
    tamanho: l.tamanho.trim() || null,
    gtin: l.gtin.trim() || null,
    preco: numOuNull(l.preco) ?? 0,
    custo: numOuNull(l.custo),
    estoqueInicial: numOuNull(l.estoqueInicial),
    pesoGramas: numOuNull(l.pesoGramas),
    alturaCm: numOuNull(l.alturaCm),
    larguraCm: numOuNull(l.larguraCm),
    comprimentoCm: numOuNull(l.comprimentoCm),
  }));
  return {
    nomePai: pai.nomePai.trim(),
    descricaoPai: pai.descricaoPai.trim() || null,
    unidade: pai.unidade.trim() || null,
    fornecedor: pai.fornecedor.trim() || null,
    origem: pai.origem,
    genero: pai.genero,
    chaveCadastro,
    variacoes,
    ...(fiscal ? {
      fiscal: {
        ncm: fiscal.ncm,
        cest: fiscal.cest || null,
        origemNfe: Number(fiscal.origemNfe),
        fci: fiscal.fci || null,
        exTipi: fiscal.exTipi || null,
        tributacaoIcms: fiscal.tributacaoIcms,
      },
    } : {}),
  };
}
```

- [ ] **Step 3: Acrescentar o hook ao mesmo arquivo**

`salvar` recebe o payload e as fotos já resolvidas — é isso que desacopla o hook das closures `linhas`/`fotosCapa`. `porLinha` vem na **mesma ordem** das `variacoes` do payload.

```ts
export interface FotosDoCadastro {
  capa: Record<'capa' | 'capa2' | 'capa3', File | null>;
  /** Foto JÁ RESOLVIDA por linha, na MESMA ordem das `variacoes` do payload. O dialog de grade
   *  resolve a herança por cor (`resolverLinha`) ANTES de chamar — o hook nunca sabe de herança. */
  porLinha: (File | null)[];
}

export interface CadastroProdutoApi {
  chaveCadastro: string;
  salvando: boolean;
  resultado: ResultadoCadastro | null;
  enviandoFoto: boolean;
  enviandoFotos: { feitos: number; total: number } | null;
  falhasFoto: string[];
  fotosEnviadas: Set<string>;
  trocando: Set<string>;
  divergencia: { mensagem: string; loteId: string } | null;
  confirmarFechar: (() => void) | null;
  /** Alguma operação de rede em voo — fechar aqui é destrutivo. */
  ocupado: boolean;
  /** Cadastro gravado mas incompleto (fila ou estoque) — trava "Ir para a Revisão". */
  pendencias: boolean;
  salvar: (payload: ProdutoEntrada, fotos: FotosDoCadastro) => Promise<void>;
  subirFoto: (arquivo: File, alvo: AlvoFoto, loteId: string) => Promise<void>;
  reprocessar: (familiaId: string) => Promise<void>;
  comConfirmacao: (acao: () => void) => void;
  fecharConfirmacao: () => void;
  marcarEnviada: (chave: string) => void;
  marcarTrocando: (chave: string) => void;
  /** Um retry manual bem-sucedido tem que sair de `trocando`, senão o card não volta ao estado
   *  "✓ enviada" — é o comportamento de hoje, coberto pelo teste do item 1 da auditoria. */
  limparTrocando: (chave: string) => void;
  limparFalha: (rotulo: string) => void;
  irParaRevisao: (loteId: string) => void;
}

export function useCadastroProduto(
  { aberto, onCadastrado }: { aberto: boolean; onCadastrado?: () => void },
): CadastroProdutoApi {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [chaveCadastro, setChaveCadastro] = useState(() => crypto.randomUUID());
  const [resultadoAmbiguo, setResultadoAmbiguo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCadastro | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [enviandoFotos, setEnviandoFotos] = useState<{ feitos: number; total: number } | null>(null);
  const [falhasFoto, setFalhasFoto] = useState<string[]>([]);
  const [fotosEnviadas, setFotosEnviadas] = useState<Set<string>>(new Set());
  const [trocando, setTrocando] = useState<Set<string>>(new Set());
  const [divergencia, setDivergencia] = useState<{ mensagem: string; loteId: string } | null>(null);
  const [confirmarFechar, setConfirmarFechar] = useState<(() => void) | null>(null);

  // Reset ao FECHAR. `chaveCadastro` só regenera se o último resultado foi CONHECIDO — resultado
  // ambíguo (rede) preserva a chave pro retry ser reconhecido pela idempotência da edge, em vez
  // de criar um segundo produto.
  useEffect(() => {
    if (aberto) return;
    setResultado(null);
    if (!resultadoAmbiguo) setChaveCadastro(crypto.randomUUID());
    setDivergencia(null);
    setEnviandoFotos(null);
    setFalhasFoto([]);
    setFotosEnviadas(new Set());
    setTrocando(new Set());
    setConfirmarFechar(null);
  }, [aberto, resultadoAmbiguo]);

  const ocupado = salvando || enviandoFoto || enviandoFotos !== null;
  const pendencias = !!resultado && (!resultado.filaOk || resultado.falhasEstoque.length > 0);

  // `loteId` explícito (não lido de `resultado`): quando chamada pelo lote logo após
  // `setResultado(r)`, o state ainda não re-renderizou.
  async function subirFoto(arquivo: File, alvo: AlvoFoto, loteId: string) {
    setEnviandoFoto(true);
    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão ou organização.');
      if (!canWrite()) throw new Error('Suporte somente leitura.');
      const owner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);
      await uploadFotoProduto(owner, loteId, arquivo, alvo);
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      toast.success('✓ Foto enviada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar a foto.');
      throw e;
    } finally {
      setEnviandoFoto(false);
    }
  }

  /**
   * Casamento POSICIONAL, correto por quatro invariantes encadeados:
   *   1. derivarCodigos numera na ordem do array           (_shared/produto/codigos.ts:38)
   *   2. montarLinhasProduto casa variacoes[i] ↔ codigos[i] (_shared/produto/validar.ts:102)
   *   3. a edge ordena a resposta por codigo                (cadastrar-produto/index.ts:256)
   *   4. todo codigo tem 8 digitos, entao ordem lexicografica = numerica
   * Se qualquer um deles mudar, a foto vai para o SKU errado EM SILENCIO.
   *
   * Contagem divergente = retry idempotente devolveu o cadastro ORIGINAL da edge, que pode ter
   * outra quantidade de variações. Pular o casamento é mais seguro que arriscar o índice errado.
   */
  async function subirLoteDeFotos(r: ResultadoCadastro, fotos: FotosDoCadastro) {
    const alvos: Array<{ arquivo: File; alvo: AlvoFoto; rotulo: string; chave: string }> = [];
    (['capa', 'capa2', 'capa3'] as const).forEach((tipo) => {
      const arquivo = fotos.capa[tipo];
      const rotulo = tipo === 'capa' ? 'Capa' : tipo === 'capa2' ? 'Capa 2' : 'Capa 3';
      if (arquivo) alvos.push({ arquivo, alvo: { tipo, familiaId: r.familiaId }, rotulo, chave: tipo });
    });
    const falhas: string[] = [];
    if (fotos.porLinha.length !== r.variacoes.length) {
      fotos.porLinha.forEach((f, i) => {
        if (f) falhas.push(`Variação (linha ${i + 1}, contagem divergente — vá pra Revisão)`);
      });
    } else {
      fotos.porLinha.forEach((f, i) => {
        const v = r.variacoes[i];
        if (f && v) {
          alvos.push({ arquivo: f, alvo: { tipo: 'variacao', variacaoId: v.id }, rotulo: v.codigo, chave: v.id });
        }
      });
    }
    if (alvos.length === 0 && falhas.length === 0) return;

    if (alvos.length > 0) {
      setEnviandoFotos({ feitos: 0, total: alvos.length });
      const enviadosNesteLote: string[] = [];
      for (const [i, a] of alvos.entries()) {
        try {
          await subirFoto(a.arquivo, a.alvo, r.loteId);
          enviadosNesteLote.push(a.chave);
        } catch {
          falhas.push(a.rotulo);
        }
        setEnviandoFotos({ feitos: i + 1, total: alvos.length });
      }
      setEnviandoFotos(null);
      setFotosEnviadas((prev) => new Set([...prev, ...enviadosNesteLote]));
    }
    setFalhasFoto(falhas);
  }

  async function salvar(payload: ProdutoEntrada, fotos: FotosDoCadastro) {
    setSalvando(true);
    setResultadoAmbiguo(false);
    try {
      const r = await cadastrarProduto(payload);
      setResultado(r);
      onCadastrado?.();
      setChaveCadastro(crypto.randomUUID());
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      await subirLoteDeFotos(r, fotos);
      // Segunda invalidação OBRIGATÓRIA: `imagem_path`/`capa_storage_path` só são gravados
      // dentro de uploadFotoProduto, depois da primeira.
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      if (r.filaOk && r.falhasEstoque.length === 0) toast.success('✓ Produto cadastrado');
    } catch (e) {
      if (e instanceof ProdutoJaExisteError) {
        setDivergencia({ mensagem: e.message, loteId: e.loteId });
        toast.error(e.message, {
          action: { label: 'Abrir na Revisão', onClick: () => navigate(`/revisao/${e.loteId}`) },
        });
      } else if (e instanceof CadastroResultadoAmbiguoError) {
        setResultadoAmbiguo(true);
        toast.error(e.message);
      } else {
        toast.error(e instanceof Error ? e.message : 'Falha ao cadastrar o produto.');
      }
    } finally {
      setSalvando(false);
    }
  }

  async function reprocessar(familiaId: string) {
    try {
      const { error } = await supabase.functions.invoke('reprocessar-familia', { body: { familia_id: familiaId } });
      if (error) throw error;
      toast.success('✓ Reenfileirado para o enriquecimento por IA');
      setResultado((r) => (r ? { ...r, filaOk: true } : r));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reprocessar.');
    }
  }

  // Guarda ÚNICA por onde toda saída destrutiva passa — Escape, clique fora, "Cancelar",
  // "Fechar" e "Ir para a Revisão".
  function comConfirmacao(acao: () => void) {
    if (ocupado) return;
    if (falhasFoto.length > 0) { setConfirmarFechar(() => acao); return; }
    acao();
  }

  return {
    chaveCadastro, salvando, resultado, enviandoFoto, enviandoFotos, falhasFoto,
    fotosEnviadas, trocando, divergencia, confirmarFechar, ocupado, pendencias,
    salvar, subirFoto, reprocessar, comConfirmacao,
    fecharConfirmacao: () => setConfirmarFechar(null),
    marcarEnviada: (chave) => setFotosEnviadas((prev) => new Set(prev).add(chave)),
    marcarTrocando: (chave) => setTrocando((prev) => new Set(prev).add(chave)),
    limparTrocando: (chave) => setTrocando((prev) => { const p = new Set(prev); p.delete(chave); return p; }),
    limparFalha: (rotulo) => setFalhasFoto((prev) => prev.filter((x) => x !== rotulo)),
    irParaRevisao: (loteId) => navigate(`/revisao/${loteId}`),
  };
}
```

- [ ] **Step 4: Criar `src/components/estoque/etapa-fotos.tsx`**

JSX movido de `dialog-cadastro-produto.tsx:652-790` (banners de fila/estoque, progresso, falhas, grid de capa, grid por variação). **Crítico:** não recebe `linhas` — recebe `arquivoPorIndice`/`onPatchFotoLinha`, senão o dialog de grade (cujas fotos são por cor, não por linha) não consegue reaproveitar.

```tsx
// Etapa 2 do cadastro (fotos), compartilhada pelos dois dialogs. Não conhece `LinhaVariacao`:
// quem sabe de onde vem o arquivo de cada índice é o dialog (no cadastro normal, a linha; na
// grade, a foto da cor resolvida por `resolverLinha`).
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CampoFoto } from '@/components/estoque/campo-foto';
import type { ResultadoCadastro } from '@/lib/produtos-saldo';
import type { CadastroProdutoApi } from '@/components/estoque/use-cadastro-produto';

export function EtapaFotos({
  api, resultado, fotosCapa, onEscolherCapa, arquivoPorIndice, onPatchFotoLinha,
}: {
  api: CadastroProdutoApi;
  resultado: ResultadoCadastro;
  fotosCapa: Record<'capa' | 'capa2' | 'capa3', File | null>;
  onEscolherCapa: (tipo: 'capa' | 'capa2' | 'capa3', f: File | null) => void;
  /** Arquivo em memória da i-ésima variação — `null` quando a contagem divergiu. */
  arquivoPorIndice: (i: number) => File | null;
  onPatchFotoLinha: (i: number, f: File | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!resultado.filaOk && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            O produto foi cadastrado, mas o enriquecimento por IA não foi enfileirado.
            Sem isso ele não fica pronto para publicar.
            <div className="mt-2">
              <Button size="sm" onClick={() => api.reprocessar(resultado.familiaId)}>Reprocessar</Button>
            </div>
          </div>
        </div>
      )}
      {resultado.falhasEstoque.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            O estoque inicial não foi aplicado nestes SKUs — use “Dar entrada” na tela de
            Estoque para corrigir:
            <ul className="mt-1 list-inside list-disc font-mono text-xs">
              {resultado.falhasEstoque.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        </div>
      )}
      {api.enviandoFotos && (
        <p className="text-sm text-muted-foreground">
          enviando fotos ({api.enviandoFotos.feitos}/{api.enviandoFotos.total})…
        </p>
      )}
      {api.falhasFoto.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>Falha ao enviar a foto de: {api.falhasFoto.join(', ')}. Envie de novo abaixo.</div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Fotos do produto</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {(['capa', 'capa2', 'capa3'] as const).map((tipo) => {
            const rotulo = tipo === 'capa' ? 'Capa' : tipo === 'capa2' ? 'Capa 2' : 'Capa 3';
            // FALHOU tem prioridade sobre ENVIADA: um retry manual que falhou depois de um
            // sucesso anterior ainda precisa pedir o arquivo de novo.
            const status: 'falhou' | 'enviada' | 'naoEnviada' = api.falhasFoto.includes(rotulo)
              ? 'falhou' : api.fotosEnviadas.has(tipo) ? 'enviada' : 'naoEnviada';
            return (
              <div key={tipo} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{rotulo}</span>
                <CampoFoto
                  id={`retry-capa-${tipo}`}
                  ariaLabel={rotulo}
                  arquivo={fotosCapa[tipo]}
                  disabled={api.enviandoFoto}
                  enviada={status === 'enviada' && !api.trocando.has(tipo)}
                  opcional={status === 'naoEnviada'}
                  onTrocar={() => api.marcarTrocando(tipo)}
                  onEscolher={(f) => {
                    if (f) {
                      // Retry manual bem-sucedido apaga o aviso de falha desse alvo (senão o
                      // banner vermelho contradiz o toast de sucesso), marca como enviado e sai
                      // de `trocando` — é o que devolve o card ao estado "✓ enviada".
                      api.subirFoto(f, { tipo, familiaId: resultado.familiaId }, resultado.loteId)
                        .then(() => { api.limparFalha(rotulo); api.marcarEnviada(tipo); api.limparTrocando(tipo); })
                        .catch(() => {});
                    } else {
                      api.limparFalha(rotulo);
                    }
                    onEscolherCapa(tipo, f);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Foto por variação</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {resultado.variacoes.map((v, i) => {
            const status: 'falhou' | 'enviada' | 'naoEnviada' = api.falhasFoto.includes(v.codigo)
              ? 'falhou' : api.fotosEnviadas.has(v.id) ? 'enviada' : 'naoEnviada';
            return (
              <div key={v.id} className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted-foreground">{v.codigo}</span>
                <CampoFoto
                  id={`retry-var-${v.id}`}
                  ariaLabel={v.codigo}
                  arquivo={arquivoPorIndice(i)}
                  disabled={api.enviandoFoto}
                  enviada={status === 'enviada' && !api.trocando.has(v.id)}
                  opcional={status === 'naoEnviada'}
                  onTrocar={() => api.marcarTrocando(v.id)}
                  onEscolher={(f) => {
                    if (f) {
                      api.subirFoto(f, { tipo: 'variacao', variacaoId: v.id }, resultado.loteId)
                        .then(() => { api.limparFalha(v.codigo); api.marcarEnviada(v.id); api.limparTrocando(v.id); })
                        .catch(() => {});
                    } else {
                      api.limparFalha(v.codigo);
                    }
                    onPatchFotoLinha(i, f);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

**Atenção ao contrato de `resultado`:** a prop é `ResultadoCadastro` (não-nula) — o dialog só monta `<EtapaFotos>` dentro do ramo em que `api.resultado` já existe. Use uma constante local (`const resultado = api.resultado; if (!resultado) return ...`) em vez de `api.resultado!` espalhado.

- [ ] **Step 5: Reescrever `dialog-cadastro-produto.tsx` consumindo o hook**

Trocar os 12 `useState` extraídos por `const api = useCadastroProduto({ aberto, onCadastrado });`. Manter no dialog **só** o estado de formulário: `nomePai`, `descricaoPai`, `unidade`, `fornecedor`, `origem`, `genero`, `linhas`, `fotosCapa`, `tentouSalvar`, `etapaFiscal`, `fiscal`, `sugestaoNcm`, `carregandoSugestao` — e o `useEffect` de reset desses campos (com dependência só `[aberto]`, já que `resultadoAmbiguo` foi para dentro do hook), o efeito de prefill (`inicial`) e o efeito de sugestão de NCM. O submit vira:

```tsx
function submeter() {
  if (!origem) return;
  setTentouSalvar(true);
  api.salvar(
    montarPayload(
      { nomePai, descricaoPai, unidade, fornecedor, origem, genero: genero || null },
      linhas, api.chaveCadastro, fiscalAtivo ? fiscal : undefined,
    ),
    { capa: fotosCapa, porLinha: linhas.map((l) => l.foto) },
  );
}
```

E a etapa 2 vira (dentro do ramo onde `const resultado = api.resultado` já é não-nulo):

```tsx
<EtapaFotos
  api={api}
  resultado={resultado}
  fotosCapa={fotosCapa}
  onEscolherCapa={(tipo, f) => setFotosCapa((prev) => ({ ...prev, [tipo]: f }))}
  // Mesmo casamento posicional de `subirLoteDeFotos`: só existe arquivo em memória para mostrar
  // a miniatura quando a contagem bate.
  arquivoPorIndice={(i) => (
    linhas.length === resultado.variacoes.length ? linhas[i]?.foto ?? null : null
  )}
  onPatchFotoLinha={(i, foto) => {
    if (linhas.length !== resultado.variacoes.length) return;
    setLinhas((prev) => prev.map((x, idx) => (idx === i ? { ...x, foto } : x)));
  }}
/>
```

Trocar todas as referências restantes (`salvando` → `api.salvando`, `ocupado` → `api.ocupado`, `resultado` → `api.resultado`, `divergencia` → `api.divergencia`, `comConfirmacao` → `api.comConfirmacao`, o `AlertDialog` de confirmar fechar usa `api.confirmarFechar`/`api.fecharConfirmacao`). **Não** mudar nenhum texto, `aria-label`, `id` ou rótulo — os testes casam por texto exato.

- [ ] **Step 6: Rodar a suíte e confirmar verde SEM editar o teste**

Run: `pnpm test src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx`
Expected: PASS, com a MESMA contagem do Step 1. Qualquer falha é regressão da extração — corrigir o código, nunca o teste.

- [ ] **Step 7: Rodar o resto do que toca esses arquivos**

Run: `pnpm test src/components/estoque src/pages/__tests__ tests/components`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add src/components/estoque/use-cadastro-produto.ts src/components/estoque/etapa-fotos.tsx src/components/estoque/dialog-cadastro-produto.tsx
/usr/bin/git commit -m "refactor(estoque): extrai useCadastroProduto e EtapaFotos do dialog de cadastro"
```

---

## Task 2: Reverter o dialog de cadastro normal ao formato de antes do ADR-0166

**Modelo:** `sonnet`. Remoção mecânica guiada por testes; a única sutileza (manter `genero: null` no payload) está explicitada abaixo.

**Files:**
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx`
- Modify: `src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx:904-961` (o describe do R3)

**Interfaces:**
- Consumes: `montarPayload` de `use-cadastro-produto.ts` (Task 1).
- Produces: `DialogCadastroProduto` sem eixo de tamanho; `LinhaVariacaoForm` deixa de receber `gruposTamanho` em qualquer call site.

**Atenção (a rede de 900 linhas NÃO cobre esta task):** os 3 testes do describe `gênero obrigatório com tamanho (ADR-0166 / R3)` testam exatamente o comportamento que está sendo removido. Eles **vão ser editados nesta task** — ao contrário da Task 1, onde editar teste era sinal de erro.

- [ ] **Step 1: Escrever o teste do novo comportamento (substituindo o describe do R3)**

Substituir o bloco `dialog-cadastro-produto.test.tsx:904-961` inteiro por:

```tsx
// Revert do ADR-0166 (spec 2026-09-19 §1): o eixo Gênero/Tamanho/Cor saiu deste dialog e virou
// tela própria (dialog-cadastro-grade.tsx). Uma org COM roupa habilitada tem que ver aqui
// exatamente o que uma org sem tipo nenhum vê.
describe('DialogCadastroProduto — sem eixo de grade, mesmo com tipo habilitado', () => {
  beforeEach(() => tiposProdutoMock.mockReturnValue({ data: ['roupa'] }));
  afterEach(() => tiposProdutoMock.mockReturnValue({ data: [] as string[] }));

  it('org de roupa NÃO vê Gênero, nem Tamanho na variação, nem o gerador de variações', () => {
    renderDialogCom();
    expect(screen.queryByLabelText(/^Gênero/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tamanho da variação 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Gerar variações')).not.toBeInTheDocument();
  });

  it('o botão libera sem gênero — o gate condicional de hoje não existe mais', async () => {
    const user = userEvent.setup();
    renderDialogCom();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta Básica');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Cor / nome da variação 1'), 'Azul');
    await user.type(screen.getByLabelText('Preço mínimo (líquido) da variação 1'), '50');
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeEnabled();
  });

  // O payload NÃO pode perder os campos: `genero` e `tamanho` continuam existindo no contrato da
  // edge e o dialog de grade depende deles. Um "revert limpo" que os apagasse de `montarPayload`
  // quebraria a outra tela em silêncio — é o único teste que trava isso.
  it('payload continua carregando genero: null e tamanho: null', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'lote-1', familiaId: 'fam-1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }],
    });
    const user = userEvent.setup();
    renderDialogCom();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta Básica');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Cor / nome da variação 1'), 'Azul');
    await user.type(screen.getByLabelText('Preço mínimo (líquido) da variação 1'), '50');

    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    const payload = cadastrarProdutoMock.mock.calls[0][0];
    expect(payload).toHaveProperty('genero', null);
    expect(payload.variacoes[0]).toHaveProperty('tamanho', null);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx -t "sem eixo de grade"`
Expected: FAIL — o primeiro teste acha o `<select>` de Gênero, que ainda existe.

- [ ] **Step 3: Remover o eixo de grade do dialog**

Em `dialog-cadastro-produto.tsx`, remover:
1. os imports `useTiposProdutoHabilitados`, `opcoesDeTamanho`, `GeradorVariacoes`;
2. `const { data: tiposProduto } = ...`, `const gruposTamanho = ...`, `const temEixoTamanho = ...`;
3. o state `genero` e seu reset;
4. o bloco JSX inteiro do campo Gênero (o `{temEixoTamanho && (...)}` dentro do `grid sm:grid-cols-3`);
5. `const algumaLinhaComTamanho = ...` e a cláusula `&& (!algumaLinhaComTamanho || !!genero)` de `podeSalvar`;
6. o bloco `{temEixoTamanho && (<GeradorVariacoes ... />)}`;
7. a prop `gruposTamanho={...}` passada a `LinhaVariacaoForm`.

Trocar a condição da dica "Produto sem variação?" de `linhas.length === 1 && !temEixoTamanho` para `linhas.length === 1`.

Em `submeter()`, trocar `genero: genero || null` por `genero: null` e deixar o comentário:

```tsx
// Revert do ADR-0166: esta tela não pergunta Gênero. O campo continua no payload (a edge o
// aceita e o dialog de grade o preenche de verdade) — remover daqui a CHAVE, e não só o valor,
// quebraria `dialog-cadastro-grade.tsx` sem nenhum teste acusar.
genero: null,
```

- [ ] **Step 4: Rodar a suíte inteira do arquivo**

Run: `pnpm test src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx`
Expected: PASS (todos, incluindo os 3 novos).

- [ ] **Step 5: Rodar o estático (o import órfão de `GeradorVariacoes` é erro de lint)**

Run: `pnpm lint && pnpm exec tsc -b --force`
Expected: sem erros. `GeradorVariacoes` fica sem consumidor entre esta task e a Task 8 — **verificado** que isso não derruba o portão: a única regra de "não usado" configurada é `@typescript-eslint/no-unused-vars` (`eslint.config.js:31`), que só olha símbolos locais do módulo, nunca exports; e `preflight:static` não roda `knip` nem `ts-prune`. Se mesmo assim o gate ficar vermelho aqui, **não** improvise: a correção é rodar a Task 6 antes desta.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/components/estoque/dialog-cadastro-produto.tsx src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx
/usr/bin/git commit -m "revert(estoque): tira o eixo de grade do dialog de cadastro normal"
```

---

## Task 3: `reconciliarGrade` — a função pura que decide o que entra e sai da grade

**Modelo:** `sonnet`. Função pura com teste próprio; a especificação dos casos é completa.

**Files:**
- Create: `src/lib/cadastro-grade.ts`
- Test: `src/lib/__tests__/cadastro-grade.test.ts`

**Interfaces:**
- Consumes: `LIMITE_VARIACOES_GERADAS` de `src/lib/tamanhos.ts`.
- Produces: `chaveGrade(cor, tamanho): string`, `totalDaGrade(cores, tamanhos, removidas): number`, `reconciliarGrade(cores, tamanhos, removidas, linhasAtuais): Reconciliacao`, tipo `Combinacao { cor: string; tamanho: string }`.

**Nota de projeto:** esta função substitui `gerarCombinacoes`/`contarCombinacoes` (`src/lib/tamanhos.ts:55-77`), que ficam sem nenhum consumidor depois da Task 6 — verificado por grep em `src/`, `supabase/` e `tests/`. A remoção delas é órfão criado por esta mudança (CLAUDE.md §3) e está na Task 11.

- [ ] **Step 1: Escrever o teste falho**

```ts
import { describe, expect, it } from 'vitest';
import { chaveGrade, reconciliarGrade, totalDaGrade } from '@/lib/cadastro-grade';

const semLinhas: { cor: string; tamanho: string }[] = [];

describe('reconciliarGrade', () => {
  it('cor sem tamanho (ou tamanho sem cor) não gera nada — na grade toda linha tem os 2 eixos', () => {
    expect(reconciliarGrade(['Azul'], [], new Set(), semLinhas).novas).toEqual([]);
    expect(reconciliarGrade([], ['P'], new Set(), semLinhas).novas).toEqual([]);
  });

  it('cartesiano na ordem cor-externa, tamanho-interno', () => {
    expect(reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], new Set(), semLinhas).novas).toEqual([
      { cor: 'Azul', tamanho: 'P' }, { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ]);
  });

  it('marcar um tamanho a mais devolve SÓ as combinações novas', () => {
    const atuais = [{ cor: 'Azul', tamanho: 'P' }, { cor: 'Preto', tamanho: 'P' }];
    const r = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], new Set(), atuais);
    expect(r.novas).toEqual([{ cor: 'Azul', tamanho: 'M' }, { cor: 'Preto', tamanho: 'M' }]);
    expect(r.remover).toEqual([]);
  });

  it('desmarcar um eixo devolve só as chaves daquele eixo em remover', () => {
    const atuais = [
      { cor: 'Azul', tamanho: 'P' }, { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ];
    const r = reconciliarGrade(['Azul'], ['P', 'M'], new Set(), atuais);
    expect(r.novas).toEqual([]);
    expect(r.remover).toEqual([chaveGrade('Preto', 'P'), chaveGrade('Preto', 'M')]);
  });

  it('combinação já existente marcada de novo não duplica', () => {
    const atuais = [{ cor: 'Azul', tamanho: 'P' }];
    const r = reconciliarGrade(['Azul'], ['P'], new Set(), atuais);
    expect(r.novas).toEqual([]);
    expect(r.remover).toEqual([]);
  });

  // Grade parcial: o operador removeu Azul/P na mão e os DOIS eixos continuam marcados.
  it('combinação removida na mão NÃO reaparece enquanto os dois eixos seguem marcados', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    const atuais = [{ cor: 'Azul', tamanho: 'M' }];
    const r = reconciliarGrade(['Azul'], ['P', 'M'], removidas, atuais);
    expect(r.novas).toEqual([]);
    expect(r.removidas).toEqual(removidas);
  });

  // Desmarcar "Azul" já É a ação de "não quero Azul"; remarcar é "quero Azul por completo".
  it('desmarcar um eixo inteiro LIMPA a exclusão manual daquele eixo', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    // Azul desmarcado: a exclusão some do conjunto devolvido.
    const semAzul = reconciliarGrade(['Preto'], ['P', 'M'], removidas, semLinhas);
    expect(semAzul.removidas.size).toBe(0);
    // Remarcado a partir do conjunto já podado: Azul/P volta.
    const comAzul = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], semAzul.removidas, semLinhas);
    expect(comAzul.novas).toContainEqual({ cor: 'Azul', tamanho: 'P' });
  });

  it('ordem canônica devolve o cartesiano menos as exclusões, agrupado por cor', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    const r = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], removidas, semLinhas);
    expect(r.ordem).toEqual([
      chaveGrade('Azul', 'M'), chaveGrade('Preto', 'P'), chaveGrade('Preto', 'M'),
    ]);
  });
});

describe('totalDaGrade', () => {
  it('é o cartesiano menos as exclusões manuais ainda válidas', () => {
    expect(totalDaGrade(['Azul', 'Preto'], ['P', 'M'], new Set())).toBe(4);
    expect(totalDaGrade(['Azul', 'Preto'], ['P', 'M'], new Set([chaveGrade('Azul', 'P')]))).toBe(3);
  });

  it('exclusão de um eixo já desmarcado não conta (seria um desconto fantasma)', () => {
    expect(totalDaGrade(['Preto'], ['P', 'M'], new Set([chaveGrade('Azul', 'P')]))).toBe(2);
  });

  it('um eixo vazio zera o total — grade exige os dois', () => {
    expect(totalDaGrade(['Azul'], [], new Set())).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/lib/__tests__/cadastro-grade.test.ts`
Expected: FAIL com `Failed to resolve import "@/lib/cadastro-grade"`.

- [ ] **Step 3: Implementar**

```ts
// Spec 2026-09-19 (cadastro em grade) §2. Funções PURAS: toda a decisão de qual combinação entra
// ou sai da grade mora aqui, fora do componente, para ser testada sem montar React.
//
// Substitui `gerarCombinacoes`/`contarCombinacoes` (src/lib/tamanhos.ts): na grade, ao contrário
// do cadastro normal, cor E tamanho são obrigatórios — uma linha sem um dos eixos não existe.

/** Chave canônica de uma célula. `\u0000` porque nem cor nem tamanho podem contê-lo: um
 *  separador visível ("|") colidiria com uma cor personalizada digitada com ele. */
export function chaveGrade(cor: string, tamanho: string): string {
  return `${cor}\u0000${tamanho}`;
}

export interface Combinacao { cor: string; tamanho: string }

export interface Reconciliacao {
  /** Combinações a ACRESCENTAR às linhas atuais (nunca as que já existem). */
  novas: Combinacao[];
  /** Chaves das linhas atuais que saíram da seleção e devem ser removidas. */
  remover: string[];
  /** `removidas` já podado: exclusão cujo eixo foi desmarcado deixa de valer. */
  removidas: Set<string>;
  /** Ordem canônica (cor externa, tamanho interno) da grade válida — o dialog ordena por ela
   *  para a lista não embaralhar conforme o operador marca e desmarca. */
  ordem: string[];
  /** Cartesiano menos as exclusões manuais ainda válidas. */
  total: number;
}

/** Exclusões manuais cujos DOIS eixos continuam marcados. Desmarcar um eixo inteiro já é a ação
 *  de "não quero esse eixo"; remarcar é "quero de novo, por completo" — manter a exclusão de
 *  célula viva através desse ciclo não seria continuidade da mesma decisão. */
function podar(
  cores: readonly string[], tamanhos: readonly string[], removidas: ReadonlySet<string>,
): Set<string> {
  const validas = new Set<string>();
  for (const cor of cores) {
    for (const tamanho of tamanhos) {
      const k = chaveGrade(cor, tamanho);
      if (removidas.has(k)) validas.add(k);
    }
  }
  return validas;
}

export function totalDaGrade(
  cores: readonly string[], tamanhos: readonly string[], removidas: ReadonlySet<string>,
): number {
  if (cores.length === 0 || tamanhos.length === 0) return 0;
  return cores.length * tamanhos.length - podar(cores, tamanhos, removidas).size;
}

export function reconciliarGrade(
  cores: readonly string[],
  tamanhos: readonly string[],
  removidas: ReadonlySet<string>,
  linhasAtuais: readonly { cor: string; tamanho: string }[],
): Reconciliacao {
  const podadas = podar(cores, tamanhos, removidas);
  const ordem: string[] = [];
  const novas: Combinacao[] = [];
  const existentes = new Set(linhasAtuais.map((l) => chaveGrade(l.cor, l.tamanho)));
  const validas = new Set<string>();

  for (const cor of cores) {
    for (const tamanho of tamanhos) {
      const k = chaveGrade(cor, tamanho);
      if (podadas.has(k)) continue;
      ordem.push(k);
      validas.add(k);
      if (!existentes.has(k)) novas.push({ cor, tamanho });
    }
  }

  const remover = linhasAtuais
    .map((l) => chaveGrade(l.cor, l.tamanho))
    .filter((k) => !validas.has(k));

  return { novas, remover, removidas: podadas, ordem, total: ordem.length };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test src/lib/__tests__/cadastro-grade.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/cadastro-grade.ts src/lib/__tests__/cadastro-grade.test.ts
/usr/bin/git commit -m "feat(grade): reconciliarGrade, a funcao pura que decide as linhas da grade"
```

---

## Task 4: `resolverLinha` — herança por campo, resolvida na leitura

**Modelo:** `sonnet`. Função pura, casos completamente enumerados.

**Files:**
- Modify: `src/lib/cadastro-grade.ts`
- Test: `src/lib/__tests__/cadastro-grade.test.ts`

**Interfaces:**
- Consumes: `chaveGrade` (Task 3).
- Produces: `CAMPOS_HERDAVEIS`, tipos `CampoHerdavel`, `CamposHerdaveis`, `LinhaGrade`, `LinhaResolvida`; função `resolverLinha(cabecalho, fotoPorCor, linha): LinhaResolvida`; helper `novaLinhaGrade(cor, tamanho): LinhaGrade`.

**Princípio (spec §2, achado do Fable):** a linha guarda só os **overrides** que o operador de fato editou, nunca uma cópia do valor herdado. Mudar o cabeçalho "propaga" sozinho porque o valor efetivo é calculado na leitura — não existe evento de propagação para esquecer de disparar. **Exceção consciente:** destravar um campo semeia o override com o valor resolvido naquele instante (senão o operador começaria a editar um campo em branco). Isso não viola o princípio: um campo deliberadamente destravado, por definição, parou de seguir o cabeçalho.

- [ ] **Step 1: Escrever o teste falho**

Acrescentar ao final de `src/lib/__tests__/cadastro-grade.test.ts`:

```ts
import { novaLinhaGrade, resolverLinha, type CamposHerdaveis } from '@/lib/cadastro-grade';

const CABECALHO: CamposHerdaveis = {
  preco: '99,90', custo: '40', pesoGramas: '300',
  alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
};

describe('resolverLinha', () => {
  it('sem override, todo campo resolve para o valor do cabeçalho', () => {
    const r = resolverLinha(CABECALHO, {}, novaLinhaGrade('Azul', 'M'));
    expect(r.preco).toBe('99,90');
    expect(r.custo).toBe('40');
    expect(r.comprimentoCm).toBe('30');
  });

  it('override vale só para o campo destravado — os outros seguem herdando', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const r = resolverLinha(CABECALHO, {}, linha);
    expect(r.preco).toBe('129,90');
    expect(r.custo).toBe('40');
  });

  it('cabeçalho mudando depois não afeta campo com override', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const r = resolverLinha({ ...CABECALHO, preco: '10' }, {}, linha);
    expect(r.preco).toBe('129,90');
    expect(r.custo).toBe('40');
  });

  it('"Voltar a herdar" (apagar a chave do override) volta a resolver do cabeçalho', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: {} };
    expect(resolverLinha(CABECALHO, {}, linha).preco).toBe('99,90');
  });

  // Override de string VAZIA é uma decisão do operador ("não quero custo nesta linha"), não
  // "ainda não mexi" — tem que vencer o cabeçalho, senão o campo nunca fica limpável.
  it('override vazio vence o cabeçalho em vez de cair na herança', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { custo: '' } };
    expect(resolverLinha(CABECALHO, {}, linha).custo).toBe('');
  });

  it('cabeçalho vazio resolve para vazio, não para estado quebrado', () => {
    const vazio: CamposHerdaveis = {
      preco: '', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '',
    };
    expect(resolverLinha(vazio, {}, novaLinhaGrade('Azul', 'M')).preco).toBe('');
  });

  it('foto vem da COR quando a linha não tem override de foto', () => {
    const azul = new File([''], 'azul.jpg');
    const r = resolverLinha(CABECALHO, { Azul: azul }, novaLinhaGrade('Azul', 'M'));
    expect(r.foto).toBe(azul);
  });

  it('foto destravada individualmente vence a foto da cor', () => {
    const azul = new File([''], 'azul.jpg');
    const propria = new File([''], 'propria.jpg');
    const linha = { ...novaLinhaGrade('Azul', 'M'), foto: propria };
    expect(resolverLinha(CABECALHO, { Azul: azul }, linha).foto).toBe(propria);
  });

  it('foto destravada e ESVAZIADA (null) não volta a herdar a da cor', () => {
    const azul = new File([''], 'azul.jpg');
    const linha = { ...novaLinhaGrade('Azul', 'M'), foto: null as File | null };
    expect(resolverLinha(CABECALHO, { Azul: azul }, linha).foto).toBeNull();
  });

  it('cor sem foto nenhuma resolve para null', () => {
    expect(resolverLinha(CABECALHO, {}, novaLinhaGrade('Azul', 'M')).foto).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/lib/__tests__/cadastro-grade.test.ts -t resolverLinha`
Expected: FAIL — `resolverLinha is not a function` / erro de export.

- [ ] **Step 3: Implementar (acrescentar a `src/lib/cadastro-grade.ts`)**

```ts
/** Os 6 campos que o cabeçalho preenche uma vez e a linha herda. GTIN e Estoque ficam de fora
 *  de propósito: não existe "GTIN único" nem "estoque único" numa grade. */
export const CAMPOS_HERDAVEIS = [
  'preco', 'custo', 'pesoGramas', 'alturaCm', 'larguraCm', 'comprimentoCm',
] as const;

export type CampoHerdavel = typeof CAMPOS_HERDAVEIS[number];
export type CamposHerdaveis = Record<CampoHerdavel, string>;

export interface LinhaGrade {
  /** Identidade estável da linha (mesma razão de `LinhaVariacao.clientId`: `key` por índice +
   *  input de arquivo faz a foto escolhida "andar" para outra linha ao remover uma). */
  clientId: string;
  /** Travados depois de gerados: editá-los desalinharia a chave que a reconciliação usa. */
  cor: string;
  tamanho: string;
  gtin: string;
  estoqueInicial: string;
  /** SÓ o que o operador de fato destravou e editou. Nunca uma cópia do valor herdado. */
  overrides: Partial<CamposHerdaveis>;
  /** `undefined` = herda a foto da cor. `File`/`null` = a linha tem foto própria (inclusive a
   *  decisão explícita de "esta linha não tem foto"). */
  foto?: File | null;
}

export interface LinhaResolvida extends CamposHerdaveis {
  clientId: string; cor: string; tamanho: string; gtin: string; estoqueInicial: string;
  foto: File | null;
}

export function novaLinhaGrade(cor: string, tamanho: string): LinhaGrade {
  return { clientId: crypto.randomUUID(), cor, tamanho, gtin: '', estoqueInicial: '', overrides: {} };
}

/** Valor efetivo de cada campo da linha. Usada por TODO consumidor (montar payload, gate de
 *  salvar, resolução da foto para o upload) — se algum deles resolver por conta própria, a
 *  herança diverge entre o que a tela mostra e o que é gravado. */
export function resolverLinha(
  cabecalho: CamposHerdaveis,
  fotoPorCor: Readonly<Record<string, File | null>>,
  linha: LinhaGrade,
): LinhaResolvida {
  const campos = {} as CamposHerdaveis;
  for (const campo of CAMPOS_HERDAVEIS) {
    // `in`, não `??`: override de string vazia é decisão do operador, não "ainda não mexi".
    campos[campo] = campo in linha.overrides ? linha.overrides[campo]! : cabecalho[campo];
  }
  return {
    ...campos,
    clientId: linha.clientId,
    cor: linha.cor,
    tamanho: linha.tamanho,
    gtin: linha.gtin,
    estoqueInicial: linha.estoqueInicial,
    foto: 'foto' in linha ? linha.foto ?? null : fotoPorCor[linha.cor] ?? null,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test src/lib/__tests__/cadastro-grade.test.ts`
Expected: PASS (21 testes — 11 da Task 3 + 10 desta).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/cadastro-grade.ts src/lib/__tests__/cadastro-grade.test.ts
/usr/bin/git commit -m "feat(grade): resolverLinha, heranca por campo resolvida na leitura"
```

---

## Task 5: `COMPRIMENTO_PE_CM` como módulo folha + `numeracaoPublicavel`

**Modelo:** `sonnet`. Mecânica, mas toca código de edge (`deno check`/`deno lint` no portão) — precisa de reconferência, então não é `haiku`.

**Files:**
- Create: `supabase/functions/_shared/ml/medidas-valores.ts`
- Modify: `supabase/functions/_shared/ml/size-chart.ts:27-36` (passa a reexportar)
- Modify: `src/lib/tamanhos.ts` (acrescenta `numeracaoPublicavel`)
- Test: `src/lib/__tests__/tamanhos.test.ts`

**Por que existe esta task:** o aviso "cadastrável, mas hoje não publica no ML" (spec §2, passo 2) depende de `COMPRIMENTO_PE_CM`, que hoje mora em `size-chart.ts` — arquivo que importa `jsr:@supabase/supabase-js@2` e `../categoria/schema.ts`, e portanto **o Vite não consegue resolver**. Redigitar a tabela no frontend seria inventar dado de produto e criar drift. A saída é o mesmo precedente já usado pelo ADR-0166 (R7): módulo folha, zero imports, importado pelos dois runtimes.

**Interfaces:**
- Produces: `COMPRIMENTO_PE_CM` em `_shared/ml/medidas-valores.ts` (mesmo tipo e valores de hoje); `numeracaoPublicavel(numeracao: string, genero: 'masculino' | 'feminino' | 'unissex' | ''): boolean` em `src/lib/tamanhos.ts`.

- [ ] **Step 1: Escrever o teste falho**

Acrescentar a `src/lib/__tests__/tamanhos.test.ts`:

```ts
describe('numeracaoPublicavel (spec 2026-09-19 §2, aviso inline)', () => {
  it('numeração isolada dentro da tabela do gênero é publicável', () => {
    expect(numeracaoPublicavel('42', 'masculino')).toBe(true);
    expect(numeracaoPublicavel('42', 'feminino')).toBe(true);
  });

  // COMPRIMENTO_PE_CM.feminino para em 44; masculino vai até 48. O aviso é POR GÊNERO.
  it('45/46 publicam no masculino e NÃO publicam no feminino', () => {
    expect(numeracaoPublicavel('45', 'masculino')).toBe(true);
    expect(numeracaoPublicavel('46', 'masculino')).toBe(true);
    expect(numeracaoPublicavel('45', 'feminino')).toBe(false);
    expect(numeracaoPublicavel('46', 'feminino')).toBe(false);
  });

  // Spike 051 §13: o ML não publica chart STANDARD "Sem gênero"; unissex reaproveita a masculina.
  it('unissex segue a tabela masculina', () => {
    expect(numeracaoPublicavel('45', 'unissex')).toBe(true);
  });

  it('par de meio-número nunca publica — não existe comprimento de pé para dois números num SKU', () => {
    expect(numeracaoPublicavel('45/46', 'masculino')).toBe(false);
    expect(numeracaoPublicavel('33/34', 'feminino')).toBe(false);
  });

  // Sem gênero escolhido ainda, não dá para afirmar que NÃO publica — não assustar o operador
  // com um aviso que some assim que ele preencher o campo logo acima.
  it('sem gênero escolhido, não afirma que é impublicável', () => {
    expect(numeracaoPublicavel('45', '')).toBe(true);
  });

  it('tamanho de roupa não é assunto desta função', () => {
    expect(numeracaoPublicavel('P', 'masculino')).toBe(true);
  });
});
```

Acrescentar `numeracaoPublicavel` ao import do topo do arquivo.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/lib/__tests__/tamanhos.test.ts -t numeracaoPublicavel`
Expected: FAIL — `numeracaoPublicavel is not a function`.

- [ ] **Step 3: Criar o módulo folha**

`supabase/functions/_shared/ml/medidas-valores.ts`:

```ts
// ADR-0167 — tabela de comprimento de pé do chart STANDARD do ML, extraída de `size-chart.ts`
// para um módulo FOLHA.
//
// ATENÇÃO: este arquivo NÃO pode ganhar nenhum import — nem `import type` de `jsr:`. Ele é
// importado tanto pelo Deno (`size-chart.ts`) quanto pelo Vite (`src/lib/tamanhos.ts`, para o
// aviso "não publica no ML" do cadastro em grade), e o Vite não resolve especificador `jsr:`.
// Mesmo contrato de `_shared/produto/tipos-produto-valores.ts`.
//
// Valores: dado real do chart STANDARD do próprio ML (Spike 051 §13) — nunca estimados.
export const COMPRIMENTO_PE_CM: Readonly<Record<'masculino' | 'feminino', Readonly<Record<string, number>>>> = {
  masculino: {
    33: 22.5, 34: 23, 35: 23.5, 36: 24, 37: 24.5, 38: 25, 39: 25.5, 40: 26.5,
    41: 27.5, 42: 28, 43: 29, 44: 30, 45: 30.5, 46: 31, 47: 32, 48: 33,
  },
  feminino: {
    33: 22, 34: 22.7, 35: 23.3, 36: 24, 37: 24.7, 38: 25.3, 39: 26, 40: 26.7,
    41: 27.3, 42: 28, 43: 28.6, 44: 29.3,
  },
};
```

Em `supabase/functions/_shared/ml/size-chart.ts`, substituir a declaração de `COMPRIMENTO_PE_CM` (linhas 27-36) por:

```ts
// Movida para um módulo folha (sem imports) para o frontend também poder lê-la sem redigitar a
// tabela — ver medidas-valores.ts. Reexportada aqui para nenhum consumidor existente mudar.
export { COMPRIMENTO_PE_CM } from './medidas-valores.ts';
```

E acrescentar ao topo, junto aos outros imports: `import { COMPRIMENTO_PE_CM } from './medidas-valores.ts';` (a linha 43 usa o símbolo diretamente).

- [ ] **Step 4: Implementar `numeracaoPublicavel` em `src/lib/tamanhos.ts`**

```ts
import { COMPRIMENTO_PE_CM } from '../../supabase/functions/_shared/ml/medidas-valores';

/** `false` = a numeração cadastra normal, mas hoje NÃO tem guia de tamanhos possível no ML para
 *  esse gênero (pares de meio-número; 45/46 no feminino). Serve ao aviso inline do cadastro em
 *  grade — nunca bloqueia a seleção: o cadastro pode existir só para controle de estoque.
 *
 *  Sem gênero escolhido devolve `true`: não dá para afirmar impossibilidade antes de saber a
 *  tabela, e um aviso que some assim que o operador preenche o campo acima só assusta.
 *  Unissex reaproveita a tabela masculina (Spike 051 §13 — o ML não publica STANDARD "Sem
 *  gênero"), exatamente como `tabelaDoGenero` faz em `_shared/ml/size-chart.ts`. */
export function numeracaoPublicavel(
  numeracao: string,
  genero: 'masculino' | 'feminino' | 'unissex' | '',
): boolean {
  if (!genero) return true;
  if (!(NUMERACOES_CALCADO as readonly string[]).includes(numeracao)) return true;
  const tabela = genero === 'feminino' ? COMPRIMENTO_PE_CM.feminino : COMPRIMENTO_PE_CM.masculino;
  return numeracao in tabela;
}
```

- [ ] **Step 5: Rodar os testes dos dois lados**

Run: `pnpm test src/lib/__tests__/tamanhos.test.ts supabase/functions/_shared/ml/__tests__/size-chart.test.ts`
Expected: PASS nos dois arquivos.

- [ ] **Step 6: Confirmar que o Deno ainda aceita o módulo novo**

Run: `pnpm lint:functions && pnpm check:functions`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add supabase/functions/_shared/ml/medidas-valores.ts supabase/functions/_shared/ml/size-chart.ts src/lib/tamanhos.ts src/lib/__tests__/tamanhos.test.ts
/usr/bin/git commit -m "refactor(ml): COMPRIMENTO_PE_CM vira modulo folha e alimenta numeracaoPublicavel"
```

---

## Task 6: `GeradorVariacoes` controlado — a seleção É a ação

**Modelo:** `sonnet`. Refactor de componente com teste reescrito; contrato definido por inteiro abaixo.

**Files:**
- Modify: `src/components/estoque/gerador-variacoes.tsx`
- Rewrite: `src/components/estoque/__tests__/gerador-variacoes.test.tsx` (os 10 testes de hoje são escritos contra o botão "Gerar variações" e o callback `onGerar` — **todos morrem**; as substituições estão escritas abaixo)

**Interfaces:**
- Consumes: `GrupoTamanho` de `src/lib/tamanhos.ts`.
- Produces: `<GeradorVariacoes gruposTamanho cores tamanhos coresBloqueadas tamanhosBloqueados bloquearNovaCor avisoTamanho desabilitado onMudarCores onMudarTamanhos />` — componente **controlado**, sem estado de seleção próprio (só o texto do campo "Nova cor"). Também passa a exportar `CORES_POPULARES`, que o dialog precisa para calcular `coresBloqueadas` sem redigitar a lista.

**Decisão travada aqui (a spec deixou "a forma exata fecha na implementação"):** o bloqueio de limite é uma **prop**, não um cálculo interno. `coresBloqueadas`/`tamanhosBloqueados` são Sets calculados pelo dialog com `totalDaGrade` — só o dialog conhece `removidas`, então só ele consegue calcular o total real.

- [ ] **Step 1: Reescrever o arquivo de teste inteiro**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeradorVariacoes } from '@/components/estoque/gerador-variacoes';
import { TAMANHOS_ROUPA } from '@/lib/tamanhos';

const GRUPOS = [{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }];

function renderGerador(props: Partial<React.ComponentProps<typeof GeradorVariacoes>> = {}) {
  const onMudarCores = vi.fn();
  const onMudarTamanhos = vi.fn();
  render(
    <GeradorVariacoes
      gruposTamanho={GRUPOS}
      cores={props.cores ?? new Set()}
      tamanhos={props.tamanhos ?? new Set()}
      coresBloqueadas={props.coresBloqueadas ?? new Set()}
      tamanhosBloqueados={props.tamanhosBloqueados ?? new Set()}
      bloquearNovaCor={props.bloquearNovaCor ?? false}
      avisoTamanho={props.avisoTamanho ?? (() => null)}
      desabilitado={props.desabilitado ?? false}
      onMudarCores={props.onMudarCores ?? onMudarCores}
      onMudarTamanhos={props.onMudarTamanhos ?? onMudarTamanhos}
    />,
  );
  return { onMudarCores, onMudarTamanhos };
}

describe('GeradorVariacoes (controlado — a seleção já é a ação)', () => {
  it('não existe mais botão "Gerar variações": marcar já reporta a seleção nova', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador({ cores: new Set(['Preto']) });
    expect(screen.queryByRole('button', { name: 'Gerar variações' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Azul Marinho' }));
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Preto', 'Azul Marinho']));
  });

  it('desmarcar reporta a seleção SEM aquela cor — o pai decide se confirma', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador({ cores: new Set(['Preto', 'Azul Marinho']) });
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Azul Marinho']));
  });

  it('é controlado: o checkbox reflete a prop, não um estado interno', async () => {
    const user = userEvent.setup();
    renderGerador({ cores: new Set(['Preto']), onMudarCores: vi.fn() });
    expect(screen.getByRole('checkbox', { name: 'Preto' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Azul Marinho' }));
    // O pai não aplicou a mudança, então a UI não pode se mexer sozinha.
    expect(screen.getByRole('checkbox', { name: 'Azul Marinho' })).not.toBeChecked();
  });

  it('marcar tamanho reporta a seleção nova de tamanhos', async () => {
    const user = userEvent.setup();
    const { onMudarTamanhos } = renderGerador({ tamanhos: new Set(['P']) });
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    expect(onMudarTamanhos).toHaveBeenCalledWith(new Set(['P', 'M']));
  });

  it('cor fora da lista entra via "Adicionar cor" e aparece como badge removível', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador();
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Musgo');
    await user.click(screen.getByRole('button', { name: 'Adicionar cor' }));
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Verde Musgo']));
  });

  it('Enter no campo "Nova cor" adiciona sem precisar clicar no botão', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador();
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Musgo{Enter}');
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Verde Musgo']));
  });

  it('cor personalizada já selecionada aparece como badge com botão de remover', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador({ cores: new Set(['Verde Musgo']) });
    await user.click(screen.getByRole('button', { name: 'Remover cor Verde Musgo' }));
    expect(onMudarCores).toHaveBeenCalledWith(new Set());
  });

  it('digitar o nome de uma cor popular marca o checkbox em vez de criar um badge duplicado', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador();
    await user.type(screen.getByLabelText('Nova cor'), 'Preto{Enter}');
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Preto']));
    expect(screen.queryByRole('button', { name: 'Remover cor Preto' })).not.toBeInTheDocument();
  });

  // Limite: o clique que estouraria 60 nem acontece — nada de aceitar e falhar depois de gerar.
  it('cor bloqueada pelo limite fica desabilitada e explica o motivo', () => {
    renderGerador({ coresBloqueadas: new Set(['Amarelo']) });
    const chip = screen.getByRole('checkbox', { name: 'Amarelo' });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAccessibleDescription(/limite de 60/i);
  });

  it('tamanho bloqueado pelo limite também fica desabilitado', () => {
    renderGerador({ tamanhosBloqueados: new Set(['GG']) });
    expect(screen.getByRole('checkbox', { name: 'GG' })).toBeDisabled();
  });

  it('sem espaço para mais nenhuma cor, "Adicionar cor" trava mesmo com texto digitado', async () => {
    const user = userEvent.setup();
    renderGerador({ bloquearNovaCor: true });
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Musgo');
    expect(screen.getByRole('button', { name: 'Adicionar cor' })).toBeDisabled();
  });

  it('aviso inline por tamanho aparece junto ao checkbox', () => {
    renderGerador({ avisoTamanho: (v) => (v === 'GG' ? 'cadastrável, mas hoje não publica no Mercado Livre' : null) });
    expect(screen.getByText(/não publica no Mercado Livre/)).toBeInTheDocument();
  });

  it('desabilitado (durante o salvamento) congela toda a seleção', () => {
    renderGerador({ desabilitado: true });
    expect(screen.getByRole('checkbox', { name: 'Preto' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'P' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adicionar cor' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/components/estoque/__tests__/gerador-variacoes.test.tsx`
Expected: FAIL — erro de tipo/prop desconhecida e checkboxes que não refletem as props.

- [ ] **Step 3: Reescrever o componente**

```tsx
// ADR-0166 + spec 2026-09-19: o operador marca as cores UMA vez e os tamanhos UMA vez. Desde a
// tela de grade o componente é CONTROLADO e não tem mais botão "Gerar": a seleção já é a ação
// (cor e tamanho são cliques discretos, não um textarea onde fazia sentido esperar o operador
// terminar de digitar). Quem reconcilia as linhas é o dialog, via `reconciliarGrade`.
//
// Cor é por CLIQUE, não por texto livre: uma lista separada por vírgula era fácil de digitar
// errado (typo mescla "Azul Preto" numa cor só). CORES_POPULARES cobre o caso comum;
// "Adicionar cor" é a válvula de escape, uma cor de cada vez.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { GrupoTamanho } from '@/lib/tamanhos';

// Exportada: o dialog de grade precisa da mesma lista para calcular quais chips estourariam o
// limite. Redigitá-la lá seria duas fontes divergindo na primeira cor nova. Exportar um não-
// componente daqui é aceito pelo lint — `react-refresh/only-export-components` roda com
// `allowConstantExport: true` (eslint.config.js:26-29) e isto é um `const`.
export const CORES_POPULARES = [
  'Preto', 'Branco', 'Cinza', 'Azul Marinho', 'Azul Royal', 'Vermelho',
  'Verde Bandeira', 'Amarelo', 'Rosa', 'Roxo', 'Marrom', 'Bege',
] as const;

const MOTIVO_LIMITE = 'Marcar isto passaria do limite de 60 variações por cadastro.';

function alternar(atual: ReadonlySet<string>, valor: string, marcar: boolean): Set<string> {
  const next = new Set(atual);
  if (marcar) next.add(valor); else next.delete(valor);
  return next;
}

export function GeradorVariacoes({
  gruposTamanho, cores, tamanhos, coresBloqueadas, tamanhosBloqueados, bloquearNovaCor,
  avisoTamanho, desabilitado, onMudarCores, onMudarTamanhos,
}: {
  gruposTamanho: GrupoTamanho[];
  cores: ReadonlySet<string>;
  tamanhos: ReadonlySet<string>;
  /** Cores AINDA NÃO marcadas cuja marcação estouraria LIMITE_VARIACOES_GERADAS. Calculadas
   *  pelo dialog (só ele conhece as exclusões manuais) com `totalDaGrade`. */
  coresBloqueadas: ReadonlySet<string>;
  tamanhosBloqueados: ReadonlySet<string>;
  /** true quando nem uma cor a mais caberia no limite — trava "Adicionar cor". */
  bloquearNovaCor: boolean;
  /** Aviso inline por valor de tamanho (ex.: numeração sem guia no ML). `null` = sem aviso. */
  avisoTamanho: (valor: string) => string | null;
  /** true durante `salvando`: congela a seleção (o casamento posicional exige a lista congelada). */
  desabilitado: boolean;
  onMudarCores: (cores: Set<string>) => void;
  onMudarTamanhos: (tamanhos: Set<string>) => void;
}) {
  const [novaCor, setNovaCor] = useState('');
  // Derivado da prop, não um segundo estado: cor personalizada é toda cor selecionada que não
  // está na lista de populares. Dois estados divergiriam na primeira reconciliação.
  const personalizadas = [...cores].filter((c) => !(CORES_POPULARES as readonly string[]).includes(c));

  function adicionarCorPersonalizada() {
    const cor = novaCor.trim();
    if (!cor) return;
    // Cor popular digitada à mão apenas marca o checkbox — sem badge duplicado.
    onMudarCores(alternar(cores, cor, true));
    setNovaCor('');
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
      <span className="text-sm font-medium">Cores e tamanhos</span>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Cores</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {CORES_POPULARES.map((cor) => {
            const bloqueada = coresBloqueadas.has(cor) && !cores.has(cor);
            return (
              <label key={cor} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  aria-label={cor}
                  aria-describedby={bloqueada ? 'gerador-motivo-limite' : undefined}
                  title={bloqueada ? MOTIVO_LIMITE : undefined}
                  checked={cores.has(cor)}
                  disabled={desabilitado || bloqueada}
                  onCheckedChange={(checked) => onMudarCores(alternar(cores, cor, checked === true))}
                />
                {cor}
              </label>
            );
          })}
        </div>
        {personalizadas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {personalizadas.map((cor) => (
              <Badge key={cor} variant="secondary">
                {cor}
                <button
                  type="button"
                  aria-label={`Remover cor ${cor}`}
                  disabled={desabilitado}
                  onClick={() => onMudarCores(alternar(cores, cor, false))}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            aria-label="Nova cor"
            placeholder="Cor fora da lista"
            value={novaCor}
            disabled={desabilitado}
            onChange={(e) => setNovaCor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); adicionarCorPersonalizada(); }
            }}
            className="h-8 max-w-48"
          />
          <Button
            type="button" variant="outline" size="sm"
            title={bloquearNovaCor ? MOTIVO_LIMITE : undefined}
            disabled={desabilitado || bloquearNovaCor || !novaCor.trim()}
            onClick={adicionarCorPersonalizada}
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar cor
          </Button>
        </div>
      </div>
      {gruposTamanho.map((g) => (
        <div key={g.grupo} className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{g.grupo}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {g.valores.map((v) => {
              const bloqueado = tamanhosBloqueados.has(v) && !tamanhos.has(v);
              const aviso = avisoTamanho(v);
              return (
                <label key={v} className="flex flex-col gap-0.5 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Checkbox
                      aria-label={v}
                      aria-describedby={bloqueado ? 'gerador-motivo-limite' : undefined}
                      title={bloqueado ? MOTIVO_LIMITE : undefined}
                      checked={tamanhos.has(v)}
                      disabled={desabilitado || bloqueado}
                      onCheckedChange={(checked) => onMudarTamanhos(alternar(tamanhos, v, checked === true))}
                    />
                    {v}
                  </span>
                  {aviso && <span className="text-xs text-amber-600 dark:text-amber-500">{aviso}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {/* Um só alvo de `aria-describedby` para todos os chips bloqueados — o motivo é o mesmo. */}
      <span id="gerador-motivo-limite" className="sr-only">{MOTIVO_LIMITE}</span>
      <span className="text-xs text-muted-foreground">
        Cada cor marcada vira uma linha por tamanho marcado. Desmarcar tira só as linhas daquela
        seleção; remover uma linha na mão mantém a grade parcial.
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test src/components/estoque/__tests__/gerador-variacoes.test.tsx`
Expected: PASS (13 testes).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/components/estoque/gerador-variacoes.tsx src/components/estoque/__tests__/gerador-variacoes.test.tsx
/usr/bin/git commit -m "refactor(grade): GeradorVariacoes vira controlado, sem botao Gerar"
```

---

## Task 7: `LinhaGradeForm` — linha compacta com cadeado por campo

**Modelo:** `sonnet`.

**Files:**
- Create: `src/components/estoque/linha-grade-form.tsx`
- Test: `src/components/estoque/__tests__/linha-grade-form.test.tsx`

**Interfaces:**
- Consumes: `LinhaGrade`, `LinhaResolvida`, `CamposHerdaveis`, `CAMPOS_HERDAVEIS`, `CampoHerdavel` (Task 4); `erroCampo` de `linha-variacao-form.tsx`; `CampoFoto`.
- Produces: `<LinhaGradeForm linha resolvida tentouSalvar desabilitado podeRemover onMudar onDestravar onVoltarAHerdar onRemover />`.

**Por que não reaproveitar `LinhaVariacaoForm`:** cor/tamanho travados, modo compacto e cadeado por campo são um layout diferente o suficiente (spec §2). Reaproveita-se o **tipo** e os **helpers** (`erroCampo`), não o JSX.

- [ ] **Step 1: Escrever o teste falho**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinhaGradeForm } from '@/components/estoque/linha-grade-form';
import { novaLinhaGrade, resolverLinha, type CamposHerdaveis, type LinhaGrade } from '@/lib/cadastro-grade';

const CABECALHO: CamposHerdaveis = {
  preco: '99,90', custo: '40', pesoGramas: '300',
  alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
};

function renderLinha(linha: LinhaGrade = novaLinhaGrade('Azul', 'M'), props: {
  desabilitado?: boolean; tentouSalvar?: boolean;
} = {}) {
  const onMudar = vi.fn();
  const onMudarOverride = vi.fn();
  const onDestravar = vi.fn();
  const onVoltarAHerdar = vi.fn();
  const onRemover = vi.fn();
  render(
    <LinhaGradeForm
      linha={linha}
      resolvida={resolverLinha(CABECALHO, {}, linha)}
      tentouSalvar={props.tentouSalvar ?? false}
      desabilitado={props.desabilitado ?? false}
      podeRemover
      onMudar={onMudar}
      onMudarOverride={onMudarOverride}
      onDestravar={onDestravar}
      onVoltarAHerdar={onVoltarAHerdar}
      onRemover={onRemover}
    />,
  );
  return { onMudar, onMudarOverride, onDestravar, onVoltarAHerdar, onRemover };
}

describe('LinhaGradeForm', () => {
  it('identifica a linha por "Cor · Tamanho", nunca por "Variação N"', () => {
    renderLinha();
    expect(screen.getByText('Azul · M')).toBeInTheDocument();
    expect(screen.queryByText(/Variação \d/)).not.toBeInTheDocument();
  });

  it('cor e tamanho são texto, não campos editáveis', () => {
    renderLinha();
    expect(screen.queryByLabelText(/Cor/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Tamanho/)).not.toBeInTheDocument();
  });

  it('estoque e GTIN são por linha e reportam a mudança', async () => {
    const user = userEvent.setup();
    const { onMudar } = renderLinha();
    await user.type(screen.getByLabelText('Estoque inicial de Azul · M'), '5');
    expect(onMudar).toHaveBeenCalledWith({ estoqueInicial: '5' });
  });

  it('linha sem override mostra os herdados resumidos, sem 6 campos repetidos', () => {
    renderLinha();
    expect(screen.getByText(/herdados do produto/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Preço mínimo (líquido) de Azul · M')).not.toBeInTheDocument();
  });

  it('"Editar nesta linha" expande os 6 campos herdáveis', async () => {
    const user = userEvent.setup();
    renderLinha();
    await user.click(screen.getByRole('button', { name: /Editar nesta linha/i }));
    expect(screen.getByLabelText('Preço mínimo (líquido) de Azul · M')).toBeDisabled();
    expect(screen.getByLabelText('Custo de Azul · M')).toBeDisabled();
  });

  it('destravar um campo reporta SÓ aquele campo', async () => {
    const user = userEvent.setup();
    const { onDestravar } = renderLinha();
    await user.click(screen.getByRole('button', { name: /Editar nesta linha/i }));
    await user.click(screen.getByRole('button', { name: 'Destravar Preço mínimo (líquido) de Azul · M' }));
    expect(onDestravar).toHaveBeenCalledWith('preco');
    expect(onDestravar).toHaveBeenCalledTimes(1);
  });

  it('linha com override já abre expandida e mostra "Voltar a herdar" só no campo destravado', async () => {
    const user = userEvent.setup();
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const { onVoltarAHerdar } = renderLinha(linha);
    expect(screen.getByLabelText('Preço mínimo (líquido) de Azul · M')).toBeEnabled();
    expect(screen.getByLabelText('Custo de Azul · M')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Voltar a herdar Preço mínimo (líquido) de Azul · M' }));
    expect(onVoltarAHerdar).toHaveBeenCalledWith('preco');
  });

  it('editar um campo destravado reporta o override daquele campo', async () => {
    const user = userEvent.setup();
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const { onMudarOverride } = renderLinha(linha);
    await user.type(screen.getByLabelText('Preço mínimo (líquido) de Azul · M'), '9');
    expect(onMudarOverride).toHaveBeenCalledWith('preco', '129,909');
  });

  it('campo destravado com valor inválido mostra o erro depois de tentar salvar', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '0' } };
    renderLinha(linha, { tentouSalvar: true });
    expect(screen.getByText(/obrigatório e deve ser maior que zero/i)).toBeInTheDocument();
  });

  it('desabilitado congela remover, estoque, GTIN e os cadeados', async () => {
    const user = userEvent.setup();
    const { onRemover } = renderLinha(novaLinhaGrade('Azul', 'M'), { desabilitado: true });
    expect(screen.getByLabelText('Estoque inicial de Azul · M')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover Azul · M' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remover Azul · M' }));
    expect(onRemover).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/components/estoque/__tests__/linha-grade-form.test.tsx`
Expected: FAIL com `Failed to resolve import "@/components/estoque/linha-grade-form"`.

- [ ] **Step 3: Implementar**

```tsx
// Linha da grade (spec 2026-09-19 §2, passo 3). Layout próprio, NÃO uma variante de
// `LinhaVariacaoForm`: cor/tamanho são travados (editá-los desalinharia a chave da
// reconciliação), o modo é compacto por padrão e cada campo herdável tem seu próprio cadeado.
// Reaproveita o helper `erroCampo`, não o JSX.
import { useState } from 'react';
import { Lock, LockOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { erroCampo } from '@/components/estoque/linha-variacao-form';
import {
  CAMPOS_HERDAVEIS, type CampoHerdavel, type LinhaGrade, type LinhaResolvida,
} from '@/lib/cadastro-grade';

const ROTULOS: Record<CampoHerdavel, { rotulo: string; prefixo?: string; sufixo?: string }> = {
  // Rótulo idêntico ao de `linha-variacao-form.tsx:58` — é a ponte com a Revisão, que exibe
  // este mesmo valor como "mín. líquido".
  preco: { rotulo: 'Preço mínimo (líquido)', prefixo: 'R$' },
  custo: { rotulo: 'Custo', prefixo: 'R$' },
  pesoGramas: { rotulo: 'Peso', sufixo: 'g' },
  alturaCm: { rotulo: 'Altura', sufixo: 'cm' },
  larguraCm: { rotulo: 'Largura', sufixo: 'cm' },
  comprimentoCm: { rotulo: 'Comprimento', sufixo: 'cm' },
};

export function LinhaGradeForm({
  linha, resolvida, tentouSalvar, desabilitado, podeRemover,
  onMudar, onMudarOverride, onDestravar, onVoltarAHerdar, onRemover,
}: {
  linha: LinhaGrade;
  /** Valor efetivo já calculado por `resolverLinha` — a linha NUNCA resolve herança sozinha. */
  resolvida: LinhaResolvida;
  tentouSalvar: boolean;
  /** true durante `salvando`: a lista tem que ficar congelada (casamento posicional). */
  desabilitado: boolean;
  podeRemover: boolean;
  onMudar: (patch: Partial<Pick<LinhaGrade, 'gtin' | 'estoqueInicial' | 'foto'>>) => void;
  /** Editar um campo herdável já destravado — patch de `overrides`, não da linha crua. */
  onMudarOverride: (campo: CampoHerdavel, valor: string) => void;
  /** Destravar semeia o override com o valor resolvido no dialog — não viola "nunca copiar o
   *  herdado": um campo deliberadamente destravado parou de seguir o cabeçalho. */
  onDestravar: (campo: CampoHerdavel) => void;
  onVoltarAHerdar: (campo: CampoHerdavel) => void;
  onRemover: () => void;
}) {
  const nome = `${linha.cor} · ${linha.tamanho}`;
  const temOverride = Object.keys(linha.overrides).length > 0;
  const [expandidoManual, setExpandidoManual] = useState(false);
  const expandido = expandidoManual || temOverride;
  const id = (campo: string) => `grade-${linha.clientId}-${campo}`;

  const campoSimples = (campo: 'gtin' | 'estoqueInicial', rotulo: string) => {
    const erro = erroCampo(campo === 'gtin' ? 'gtin' : 'estoqueInicial', linha[campo]);
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id(campo)} className="text-xs text-muted-foreground">{rotulo}</label>
        <Input
          id={id(campo)}
          aria-label={`${rotulo} de ${nome}`}
          className="h-8 text-sm"
          value={linha[campo]}
          disabled={desabilitado}
          onChange={(e) => onMudar({ [campo]: e.target.value })}
        />
        {erro && tentouSalvar && <span className="text-xs text-destructive">{erro}</span>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        {/* Cor e tamanho são TEXTO, não campo: a chave da reconciliação depende deles. */}
        <span className="text-sm font-medium">{nome}</span>
        <Button
          type="button" variant="ghost" size="sm"
          disabled={desabilitado || !podeRemover}
          aria-label={`Remover ${nome}`}
          onClick={onRemover}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {campoSimples('estoqueInicial', 'Estoque inicial')}
        {campoSimples('gtin', 'GTIN')}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Foto</span>
          <CampoFoto
            id={id('foto')}
            ariaLabel={`Foto de ${nome}`}
            arquivo={resolvida.foto}
            disabled={desabilitado}
            opcional
            onEscolher={(f) => onMudar({ foto: f })}
          />
        </div>
      </div>

      {!expandido ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Preço, custo e dimensões herdados do produto ({ROTULOS.preco.prefixo} {resolvida.preco || '—'}).
          </span>
          <Button
            type="button" variant="ghost" size="sm"
            disabled={desabilitado}
            onClick={() => setExpandidoManual(true)}
          >
            Editar nesta linha
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {CAMPOS_HERDAVEIS.map((campo) => {
            const { rotulo, prefixo, sufixo } = ROTULOS[campo];
            const destravado = campo in linha.overrides;
            const erro = erroCampo(campo, resolvida[campo]);
            return (
              <div key={campo} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-1">
                  <label htmlFor={id(campo)} className="text-xs text-muted-foreground">{rotulo}</label>
                  <Button
                    type="button" variant="ghost" size="sm" className="h-6 px-1"
                    disabled={desabilitado}
                    aria-label={`${destravado ? 'Voltar a herdar' : 'Destravar'} ${rotulo} de ${nome}`}
                    onClick={() => (destravado ? onVoltarAHerdar(campo) : onDestravar(campo))}
                  >
                    {destravado ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  </Button>
                </div>
                <Input
                  id={id(campo)}
                  aria-label={`${rotulo}${sufixo ? ` (${sufixo})` : ''} de ${nome}`}
                  className="h-8 text-sm"
                  value={resolvida[campo]}
                  disabled={desabilitado || !destravado}
                  onChange={(e) => onMudarOverride(campo, e.target.value)}
                />
                {erro && tentouSalvar && destravado && (
                  <span className="text-xs text-destructive">{erro}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test src/components/estoque/__tests__/linha-grade-form.test.tsx`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/components/estoque/linha-grade-form.tsx src/components/estoque/__tests__/linha-grade-form.test.tsx
/usr/bin/git commit -m "feat(grade): LinhaGradeForm, linha compacta com cadeado por campo"
```

---

## Task 8: `dialog-cadastro-grade.tsx` — passos 0 a 3 (montar a grade certa)

**Modelo:** `sonnet`. É a maior task do plano, mas cada regra já está decidida e tem uma função pura correspondente já testada (Tasks 3 e 4) — o dialog só orquestra.

**Files:**
- Create: `src/components/estoque/dialog-cadastro-grade.tsx`
- Test: `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`

**Interfaces:**
- Consumes: `useCadastroProduto`, `montarPayload`, `CAMPOS_NUMERICOS` (Task 1); `reconciliarGrade`, `totalDaGrade`, `chaveGrade`, `resolverLinha`, `novaLinhaGrade`, `CAMPOS_HERDAVEIS` (Tasks 3-4); `numeracaoPublicavel` (Task 5); `GeradorVariacoes` (Task 6); `LinhaGradeForm` (Task 7); `opcoesDeTamanho`, `LIMITE_VARIACOES_GERADAS`; `useTiposProdutoHabilitados`; `UNIDADES_FISCAIS`; `CampoFoto`.
- Produces: `<DialogCadastroGrade aberto onFechar />`.

- [ ] **Step 1: Escrever o teste falho**

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCadastroGrade } from '../dialog-cadastro-grade';

const cadastrarProdutoMock = vi.fn();
vi.mock('@/lib/produtos-saldo', () => ({
  cadastrarProduto: (...a: unknown[]) => cadastrarProdutoMock(...a),
  uploadFotoProduto: vi.fn().mockResolvedValue(undefined),
  ProdutoJaExisteError: class extends Error {},
  CadastroResultadoAmbiguoError: class extends Error {},
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));
vi.mock('@/stores/support-store', () => ({
  effectiveOrgId: () => 'org-1', canWrite: () => true,
  useSupportStore: { getState: () => ({ context: null }) },
}));
vi.mock('@/hooks/useUploadLote', () => ({ storageOwnerForUpload: () => 'owner-1' }));
const modulosMock = vi.fn(() => ({ data: [] as string[], isLoading: false }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulosMock() }));
const tiposProdutoMock = vi.fn(() => ({ data: ['roupa'] as string[] }));
vi.mock('@/hooks/useTiposProdutoHabilitados', () => ({
  useTiposProdutoHabilitados: () => tiposProdutoMock(),
}));

function renderGrade(onFechar = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DialogCadastroGrade aberto onFechar={onFechar} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); tiposProdutoMock.mockReturnValue({ data: ['roupa'] }); });

describe('DialogCadastroGrade — passo 0 (escolha do tipo)', () => {
  it('org com 1 tipo pula o passo 0 e já mostra o cabeçalho', () => {
    renderGrade();
    expect(screen.queryByRole('button', { name: 'Calçado' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('org com os 2 tipos escolhe entre Roupa e Calçado antes de tudo', async () => {
    tiposProdutoMock.mockReturnValue({ data: ['roupa', 'calcado'] });
    const user = userEvent.setup();
    renderGrade();
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Calçado' }));
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '42' })).toBeInTheDocument();
  });

  it('trocar o tipo com linhas já geradas pede confirmação e reseta a seleção', async () => {
    tiposProdutoMock.mockReturnValue({ data: ['roupa', 'calcado'] });
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('button', { name: 'Roupa' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.type(screen.getByLabelText('GTIN de Preto · P'), '789');

    await user.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Trocar mesmo assim/i }));
    await user.click(screen.getByRole('button', { name: 'Calçado' }));
    expect(screen.queryByText('Preto · P')).not.toBeInTheDocument();
  });
});

describe('DialogCadastroGrade — passo 2 (seleção) reconcilia a grade', () => {
  it('marcar cor e tamanho gera as linhas na hora, sem botão "Gerar"', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    expect(screen.queryByText(/·/)).not.toBeInTheDocument(); // só cor ainda não gera nada
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    expect(screen.getByText('Preto · P')).toBeInTheDocument();
    expect(screen.getByText('Preto · M')).toBeInTheDocument();
  });

  it('marcar mais uma cor ACRESCENTA linhas sem apagar o que já foi digitado', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.type(screen.getByLabelText('GTIN de Preto · P'), '7891234');
    await user.click(screen.getByRole('checkbox', { name: 'Branco' }));
    expect(screen.getByLabelText('GTIN de Preto · P')).toHaveValue('7891234');
    expect(screen.getByText('Branco · P')).toBeInTheDocument();
  });

  it('desmarcar cor de linha AINDA VAZIA remove direto, sem confirmação', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Preto · P')).not.toBeInTheDocument();
  });

  it('desmarcar cor com dado digitado pede confirmação antes de apagar', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.type(screen.getByLabelText('Estoque inicial de Preto · P'), '3');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Preto · P')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Remover mesmo assim/i }));
    expect(screen.queryByText('Preto · P')).not.toBeInTheDocument();
  });

  it('remover linha na mão mantém a grade parcial — não volta sozinha', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Remover Preto · P' }));
    await user.click(screen.getByRole('checkbox', { name: 'Branco' }));
    expect(screen.queryByText('Preto · P')).not.toBeInTheDocument();
    expect(screen.getByText('Branco · P')).toBeInTheDocument();
  });

  it('desmarcar a cor inteira e remarcar LIMPA a exclusão manual', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Remover Preto · P' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' })); // desmarca o eixo inteiro
    await user.click(screen.getByRole('checkbox', { name: 'Preto' })); // remarca
    expect(screen.getByText('Preto · P')).toBeInTheDocument();
  });

  it('chip que estouraria 60 fica desabilitado em vez de falhar depois', async () => {
    const user = userEvent.setup();
    renderGrade();
    for (const t of ['P', 'M', 'G', 'GG']) await user.click(screen.getByRole('checkbox', { name: t }));
    for (const c of ['Preto', 'Branco', 'Cinza', 'Azul Marinho', 'Azul Royal',
      'Vermelho', 'Verde Bandeira', 'Amarelo', 'Rosa', 'Roxo', 'Marrom', 'Bege']) {
      await user.click(screen.getByRole('checkbox', { name: c }));
    }
    // 12 cores × 4 tamanhos = 48. Três cores a mais levam a 15 × 4 = 60, exatamente no teto.
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Musgo{Enter}');
    await user.type(screen.getByLabelText('Nova cor'), 'Vinho{Enter}');
    await user.type(screen.getByLabelText('Nova cor'), 'Laranja{Enter}');
    expect(screen.getByText('Laranja · GG')).toBeInTheDocument();
    // A 16ª cor estouraria (64). O botão trava MESMO com texto válido digitado — sem o texto
    // ele já estaria desabilitado por `!novaCor.trim()` e o teste não provaria nada.
    await user.type(screen.getByLabelText('Nova cor'), 'Caqui');
    expect(screen.getByRole('button', { name: 'Adicionar cor' })).toBeDisabled();
  });
});

describe('DialogCadastroGrade — herança de campo', () => {
  it('preço do cabeçalho aparece resumido em toda linha sem override', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    expect(screen.getByText(/R\$ 99,90/)).toBeInTheDocument();
  });

  it('mudar o cabeçalho propaga sozinho para quem não destravou', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.clear(screen.getByLabelText('Preço mínimo (líquido)'));
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '150');
    expect(screen.getByText(/R\$ 150/)).toBeInTheDocument();
  });
});

describe('DialogCadastroGrade — aviso de numeração não publicável', () => {
  beforeEach(() => tiposProdutoMock.mockReturnValue({ data: ['calcado'] }));

  it('aparece e some conforme o Gênero do cabeçalho', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'feminino');
    expect(screen.getAllByText(/não publica no Mercado Livre/).length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    // 45/46 publicam no masculino; só os pares continuam avisando.
    expect(screen.getAllByText(/não publica no Mercado Livre/)).toHaveLength(7);
  });
});

describe('DialogCadastroGrade — resumo antes de salvar', () => {
  it('conta SKUs, unidades e linhas sem foto', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.type(screen.getByLabelText('Estoque inicial de Preto · P'), '4');
    expect(screen.getByText(/2 SKUs/)).toBeInTheDocument();
    expect(screen.getByText(/4 unidades/)).toBeInTheDocument();
    expect(screen.getByText(/2 sem foto/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`
Expected: FAIL com `Failed to resolve import "../dialog-cadastro-grade"`.

- [ ] **Step 3: Implementar o dialog (passos 0 a 3)**

Estrutura obrigatória do estado e da reconciliação — o resto do JSX segue o padrão do dialog atual (mesmos `DialogContent className="max-h-[90vh] sm:max-w-3xl overflow-y-auto"`, mesmos rótulos de Nome/Descrição/Unidade/Fornecedor/Origem, mesmo `CampoFoto` para capa/capa2/capa3):

```tsx
const { data: tiposProduto } = useTiposProdutoHabilitados();
const tipos = tiposProduto ?? [];
const [tipoEscolhido, setTipoEscolhido] = useState<TipoProdutoId | null>(
  tipos.length === 1 ? (tipos[0] as TipoProdutoId) : null,
);
const gruposTamanho = opcoesDeTamanho(tipoEscolhido ? [tipoEscolhido] : []);

const [cabecalho, setCabecalho] = useState<CamposHerdaveis>({
  preco: '', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '',
});
const [cores, setCores] = useState<Set<string>>(new Set());
const [tamanhos, setTamanhos] = useState<Set<string>>(new Set());
const [removidas, setRemovidas] = useState<Set<string>>(new Set());
const [linhas, setLinhas] = useState<LinhaGrade[]>([]);
const [fotoPorCor, setFotoPorCor] = useState<Record<string, File | null>>({});
// Ação destrutiva pendente de confirmação (desmarcar eixo com dado, trocar de tipo).
const [confirmar, setConfirmar] = useState<{ titulo: string; texto: string; rotulo: string; acao: () => void } | null>(null);
```

Reconciliação num único efeito, dono da verdade:

**`linhas` NÃO entra na lista de dependências.** O efeito chama `setLinhas`; se `linhas` fosse dependência, cada clique dispararia um segundo ciclo que só pararia por causa de um `if` de guarda — uma trava não testada que o próximo a editar o efeito remove sem perceber. Ler o valor anterior dentro do updater e devolver `prev` inalterado usa o bail-out do próprio React, e o loop deixa de ser possível por construção.

```tsx
// A seleção JÁ É a ação: nenhum botão "Gerar". `reconciliarGrade` é pura e devolve o diff —
// aqui só aplicamos. Ordenar por `ordem` mantém a lista agrupada por cor mesmo depois de o
// operador marcar e desmarcar várias vezes.
useEffect(() => {
  // Poda das exclusões ANTES do updater: é o único efeito colateral do ciclo e não pertence
  // dentro de um setState (que o React pode reexecutar).
  const podadas = reconciliarGrade([...cores], [...tamanhos], removidas, []).removidas;
  if (podadas.size !== removidas.size) { setRemovidas(podadas); return; }

  setLinhas((prev) => {
    const r = reconciliarGrade([...cores], [...tamanhos], removidas, prev);
    // `prev` inalterado = bail-out do React: sem novo render, sem ciclo.
    if (r.novas.length === 0 && r.remover.length === 0) return prev;
    const fora = new Set(r.remover);
    const todas = [
      ...prev.filter((l) => !fora.has(chaveGrade(l.cor, l.tamanho))),
      ...r.novas.map((c) => novaLinhaGrade(c.cor, c.tamanho)),
    ];
    const pos = new Map(r.ordem.map((k, i) => [k, i]));
    return todas.sort((a, b) => (
      (pos.get(chaveGrade(a.cor, a.tamanho)) ?? 0) - (pos.get(chaveGrade(b.cor, b.tamanho)) ?? 0)
    ));
  });
}, [cores, tamanhos, removidas]);
```

Uma linha "tem dado" (gatilho da confirmação) quando qualquer um destes é verdade:

```tsx
function temDado(l: LinhaGrade): boolean {
  return l.gtin.trim() !== '' || l.estoqueInicial.trim() !== ''
    || Object.keys(l.overrides).length > 0 || 'foto' in l;
}
```

Desmarcar um eixo passa pela confirmação quando alguma linha afetada tem dado:

```tsx
function mudarCores(proximas: Set<string>) {
  const saindo = [...cores].filter((c) => !proximas.has(c));
  const afetadas = linhas.filter((l) => saindo.includes(l.cor));
  if (afetadas.some(temDado)) {
    setConfirmar({
      titulo: 'Remover as linhas dessa cor?',
      texto: `${afetadas.length} linha(s) já têm dado preenchido e serão apagadas.`,
      rotulo: 'Remover mesmo assim',
      acao: () => setCores(proximas),
    });
    return;
  }
  setCores(proximas);
}
```

`mudarTamanhos` é idêntica trocando `l.cor`/`cores` por `l.tamanho`/`tamanhos`. Remover uma linha na mão grava a exclusão:

```tsx
function removerLinha(l: LinhaGrade) {
  setRemovidas((prev) => new Set(prev).add(chaveGrade(l.cor, l.tamanho)));
  setLinhas((prev) => prev.filter((x) => x.clientId !== l.clientId));
}
```

Chips bloqueados pelo limite (spec §2 — o chip que estouraria fica desabilitado, não falha depois):

Cada chip pergunta "e se eu marcasse este?" — `totalDaGrade` é barato (duas multiplicações e uma varredura das exclusões), então ~33 chamadas por render não precisam de memo. `CORES_POPULARES` vem importada de `gerador-variacoes.tsx` (Task 6 a exporta), nunca redigitada.

```tsx
const coresBloqueadas = new Set(
  CORES_POPULARES.filter((c) => !cores.has(c)
    && totalDaGrade([...cores, c], [...tamanhos], removidas) > LIMITE_VARIACOES_GERADAS),
);
const tamanhosBloqueados = new Set(
  gruposTamanho.flatMap((g) => g.valores).filter((t) => !tamanhos.has(t)
    && totalDaGrade([...cores], [...tamanhos, t], removidas) > LIMITE_VARIACOES_GERADAS),
);
// Mesmo critério para "Adicionar cor", medido com uma cor hipotética que nunca colide com uma
// cor real (o `\u0001` não é digitável no campo).
const bloquearNovaCor =
  totalDaGrade([...cores, '\u0001hipotetica'], [...tamanhos], removidas) > LIMITE_VARIACOES_GERADAS;
```

Aviso por tamanho e resumo:

```tsx
const avisoTamanho = (v: string) => (
  tipoEscolhido === 'calcado' && !numeracaoPublicavel(v, genero)
    ? 'cadastrável, mas hoje não publica no Mercado Livre'
    : null
);

const resolvidas = linhas.map((l) => resolverLinha(cabecalho, fotoPorCor, l));
const unidades = resolvidas.reduce((s, r) => s + (Number(r.estoqueInicial) || 0), 0);
const semFoto = resolvidas.filter((r) => !r.foto).length;
```

Gênero é **incondicionalmente obrigatório** nesta tela (spec §2, passo 1) — mesma forma do campo `origem`:

```tsx
const podeSalvar = !!nomePai.trim() && !!origem && !!genero && linhas.length > 0
  && resolvidas.every((r) => CAMPOS_NUMERICOS.every((c) => !erroCampo(c, r[c] ?? '')));
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/components/estoque/dialog-cadastro-grade.tsx src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx
/usr/bin/git commit -m "feat(grade): dialog de cadastro em grade monta a grade e herda por campo"
```

---

## Task 9: `dialog-cadastro-grade.tsx` — etapa fiscal, salvar e fotos

**Modelo:** `sonnet`.

**Files:**
- Modify: `src/components/estoque/dialog-cadastro-grade.tsx`
- Modify: `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`

**Interfaces:**
- Consumes: `useCadastroProduto`, `montarPayload`, `EtapaFotos` (Task 1); `EtapaFiscalForm`, `fiscalVazio`, `fiscalCompleto` (existentes); `resolverLinha` (Task 4).
- Produces: nada novo — fecha o dialog.

- [ ] **Step 1: Escrever os testes falhos**

```tsx
describe('DialogCadastroGrade — etapa fiscal (ADR-0135 D-9)', () => {
  beforeEach(() => modulosMock.mockReturnValue({ data: ['fiscal'], isLoading: false }));
  afterEach(() => modulosMock.mockReturnValue({ data: [], isLoading: false }));

  it('com o módulo fiscal, o passo fiscal existe e a numeração de etapas cresce', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '50');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(screen.getByLabelText('NCM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });
});

describe('DialogCadastroGrade — salvar', () => {
  it('payload tem 1 variação por combinação, com os herdados já resolvidos', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }, { id: 'v2', codigo: '00000002' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.type(screen.getByLabelText('Peso'), '300');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    const p = cadastrarProdutoMock.mock.calls[0][0];
    expect(p.genero).toBe('masculino');
    expect(p.variacoes).toHaveLength(2);
    expect(p.variacoes[0]).toMatchObject({ nome: 'Preto', tamanho: 'P', preco: 99.9, pesoGramas: 300 });
    expect(p.variacoes[1]).toMatchObject({ nome: 'Preto', tamanho: 'M', preco: 99.9, pesoGramas: 300 });
  });

  it('override de uma linha vence o cabeçalho no payload', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: /Editar nesta linha/i }));
    await user.click(screen.getByRole('button', { name: 'Destravar Preço mínimo (líquido) de Preto · P' }));
    await user.clear(screen.getByLabelText('Preço mínimo (líquido) de Preto · P'));
    await user.type(screen.getByLabelText('Preço mínimo (líquido) de Preto · P'), '129,90');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    expect(cadastrarProdutoMock.mock.calls[0][0].variacoes[0].preco).toBe(129.9);
  });

  it('a foto da COR vai para TODA linha daquela cor, uma por SKU', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }, { id: 'v2', codigo: '00000002' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.upload(screen.getByLabelText('Foto da cor Preto'), new File(['x'], 'preto.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    const { uploadFotoProduto } = await import('@/lib/produtos-saldo');
    await waitFor(() => expect(uploadFotoProduto).toHaveBeenCalledTimes(2));
    expect(vi.mocked(uploadFotoProduto).mock.calls[0][3]).toEqual({ tipo: 'variacao', variacaoId: 'v1' });
    expect(vi.mocked(uploadFotoProduto).mock.calls[1][3]).toEqual({ tipo: 'variacao', variacaoId: 'v2' });
  });

  it('durante o salvamento a grade fica congelada (casamento posicional)', async () => {
    let liberar: (v: unknown) => void = () => {};
    cadastrarProdutoMock.mockReturnValueOnce(new Promise((res) => { liberar = res; }));
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(screen.getByRole('checkbox', { name: 'Branco' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover Preto · P' })).toBeDisabled();
    liberar({ loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [], variacoes: [{ id: 'v1', codigo: '00000001' }] });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx -t salvar`
Expected: FAIL — não existe botão "Cadastrar" que chame `cadastrarProduto`.

- [ ] **Step 3: Implementar**

Acrescentar ao dialog o campo de foto por cor (um `CampoFoto` por cor selecionada, `ariaLabel={`Foto da cor ${cor}`}`, gravando em `fotoPorCor`), a etapa fiscal e o submit:

```tsx
const api = useCadastroProduto({ aberto });
const { data: modulos } = useModulosHabilitados();
const fiscalAtivo = !!modulos?.includes('fiscal');
const [etapaFiscal, setEtapaFiscal] = useState(false);
const [fiscal, setFiscal] = useState<FiscalForm>(fiscalVazio());

function submeter() {
  if (!origem || !genero) return;
  setTentouSalvar(true);
  // `resolvidas` é a MESMA lista que a tela mostra — o payload nunca resolve herança por
  // conta própria (spec §2: `resolverLinha` é usada consistentemente).
  const variacoes: LinhaVariacao[] = resolvidas.map((r) => ({
    clientId: r.clientId, nome: r.cor, tamanho: r.tamanho, gtin: r.gtin,
    preco: r.preco, custo: r.custo, estoqueInicial: r.estoqueInicial,
    pesoGramas: r.pesoGramas, alturaCm: r.alturaCm, larguraCm: r.larguraCm,
    comprimentoCm: r.comprimentoCm, foto: r.foto,
  }));
  api.salvar(
    montarPayload(
      { nomePai, descricaoPai, unidade, fornecedor, origem, genero },
      variacoes, api.chaveCadastro, fiscalAtivo ? fiscal : undefined,
    ),
    { capa: fotosCapa, porLinha: resolvidas.map((r) => r.foto) },
  );
}
```

O congelamento é `desabilitado={api.salvando}` propagado a `GeradorVariacoes` e a cada `LinhaGradeForm`. A numeração do título segue o padrão do dialog atual, com um passo a mais quando há escolha de tipo: `etapa N de M`, `M = 2 + (fiscalAtivo ? 1 : 0) + (tipos.length > 1 ? 1 : 0)`.

A etapa 2 reaproveita `EtapaFotos` sem nenhuma adaptação de contrato — a foto já vem resolvida:

```tsx
<EtapaFotos
  api={api}
  resultado={api.resultado}
  fotosCapa={fotosCapa}
  onEscolherCapa={(tipo, f) => setFotosCapa((prev) => ({ ...prev, [tipo]: f }))}
  arquivoPorIndice={(i) => resolvidas[i]?.foto ?? null}
  onPatchFotoLinha={(i, foto) => {
    const alvo = linhas[i];
    if (!alvo) return;
    setLinhas((prev) => prev.map((x) => (x.clientId === alvo.clientId ? { ...x, foto } : x)));
  }}
/>
```

- [ ] **Step 4: Rodar o arquivo inteiro**

Run: `pnpm test src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`
Expected: PASS (todos os describes das Tasks 8 e 9).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/components/estoque/dialog-cadastro-grade.tsx src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx
/usr/bin/git commit -m "feat(grade): etapa fiscal, salvar e fotos por cor no dialog de grade"
```

---

## Task 10: Botão "Cadastrar com grade" em `Estoque.tsx`

**Modelo:** `sonnet`.

**Files:**
- Modify: `src/pages/Estoque.tsx:6` (import do ícone), `:14` (import do dialog), `:57` (state), `:156-166` (actions do `PageHeader`), `:247-250` (montagem do dialog)
- Test: `tests/pages/Estoque.test.tsx` (se existir; senão criar `src/pages/__tests__/Estoque.grade.test.tsx` — **conferir primeiro** com `ls tests/pages src/pages/__tests__`)

**Interfaces:**
- Consumes: `DialogCadastroGrade` (Tasks 8-9), `useTiposProdutoHabilitados`.
- Produces: nada.

- [ ] **Step 1: Localizar o arquivo de teste da página**

Run: `ls tests/pages src/pages/__tests__ 2>/dev/null | grep -i estoque`
Se houver um `Estoque.test.tsx`, acrescentar o describe abaixo nele (reaproveitando os mocks já montados lá). Se não houver, criar `src/pages/__tests__/Estoque.grade.test.tsx` com o mesmo conjunto de mocks usado por `dialog-cadastro-grade.test.tsx`.

- [ ] **Step 2: Escrever o teste falho**

```tsx
describe('Estoque — botão "Cadastrar com grade" (spec 2026-09-19 §1)', () => {
  it('org SEM tipo de produto habilitado não vê o botão', () => {
    tiposProdutoMock.mockReturnValue({ data: [] });
    renderEstoque();
    expect(screen.getByRole('button', { name: /Cadastrar produto/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cadastrar com grade/ })).not.toBeInTheDocument();
  });

  it('org COM roupa habilitado vê os dois botões, lado a lado', () => {
    tiposProdutoMock.mockReturnValue({ data: ['roupa'] });
    renderEstoque();
    expect(screen.getByRole('button', { name: /Cadastrar produto/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cadastrar com grade/ })).toBeInTheDocument();
  });

  it('clicar abre o dialog de grade, não o de cadastro normal', async () => {
    tiposProdutoMock.mockReturnValue({ data: ['roupa'] });
    const user = userEvent.setup();
    renderEstoque();
    await user.click(screen.getByRole('button', { name: /Cadastrar com grade/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/grade/i);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pnpm test <caminho do arquivo de teste> -t "Cadastrar com grade"`
Expected: FAIL — o botão não existe.

- [ ] **Step 4: Implementar**

```tsx
// spec 2026-09-19 §1: segundo botão, SÓ para org com tipo de produto habilitado (ADR-0166).
// "Cadastrar produto" continua byte a byte igual ao de sempre — sem eixo de grade.
const { data: tiposProduto } = useTiposProdutoHabilitados();
const temTipoProduto = (tiposProduto?.length ?? 0) > 0;
const [gradeAberta, setGradeAberta] = useState(false);
```

No `actions` do `PageHeader`, entre "Dar entrada" e "Cadastrar produto":

```tsx
{temTipoProduto && (
  <Button variant="outline" onClick={() => setGradeAberta(true)}>
    <Grid3x3 className="mr-2 h-4 w-4" />
    Cadastrar com grade
  </Button>
)}
```

E junto dos outros dialogs:

```tsx
<DialogCadastroGrade aberto={gradeAberta} onFechar={() => setGradeAberta(false)} />
```

Acrescentar `Grid3x3` ao import de `lucide-react` (linha 6) e `DialogCadastroGrade`/`useTiposProdutoHabilitados` aos imports.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm test src/pages tests/pages`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/pages/Estoque.tsx
/usr/bin/git commit -m "feat(estoque): botao Cadastrar com grade para org de roupa/calcado"
```

(Acrescente ao `git add` o arquivo de teste que o Step 1 escolheu.)

---

## Task 11: Remover "Tamanho Único" e limpar os órfãos

**Modelo:** `sonnet`. Mexe na validação da edge `cadastrar-produto` (a lista é a whitelist do backend), então precisa de reconferência — não é `haiku`.

**Files:**
- Modify: `supabase/functions/_shared/produto/tipos-produto-valores.ts:17`
- Modify: `src/lib/tipos-produto.ts:29`
- Modify: `src/lib/tamanhos.ts` (remover `gerarCombinacoes`, `contarCombinacoes`, `limparLista`, `Combinacao`)
- Modify: `src/components/estoque/linha-variacao-form.tsx` (remover a prop `gruposTamanho` e o `<select>` de tamanho)
- Delete: `src/components/estoque/__tests__/linha-variacao-tamanho.test.tsx`
- Modify: `src/lib/__tests__/tamanhos.test.ts:9` e `:37-84`
- Modify: `supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts:41`
- Modify: `supabase/functions/cadastrar-produto/__tests__/processar.test.ts:356`

**Órfãos confirmados por grep em `src/`, `supabase/` e `tests/` (as duas árvores de teste do repo):**
- `gruposTamanho` como prop de `LinhaVariacaoForm` — sem nenhum call site depois da Task 2 (`dialog-adicionar-variacao.tsx` nunca passou a prop).
- `linha-variacao-tamanho.test.tsx` — testa exatamente essa prop.
- `gerarCombinacoes`/`contarCombinacoes`/`limparLista`/`Combinacao` em `src/lib/tamanhos.ts` — sem consumidor depois da Task 6. **Acréscimo ao §6 da spec**: o Fable não os traçou, mas são órfãos criados por esta mudança (CLAUDE.md §3).
- `src/lib/__tests__/tamanhos.test.ts:37-84` (`describe('gerarCombinacoes')`, 7 testes) — vão junto com as funções.

**NÃO tocar:** `supabase/functions/_shared/ml/__tests__/size-chart.test.ts:50,92`. Eles passam a string literal `'Único'` (não `'Tamanho Único'`, nem importam `TAMANHOS_ROUPA`) e testam o caminho de falha alta para valor sem medida confirmada — continuam válidos e valiosos. Só comentários daquele arquivo citam "Tamanho Único".

- [ ] **Step 1: Checagem SQL informativa (não bloqueia nada)**

Confirmar se o próprio teste do Diego deixou alguma variação gravada com o valor que está saindo da lista. O resultado **não altera o plano** — vira dado morto sem migration; é só para ninguém estranhar no banco depois.

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -X POST "https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select count(*) as linhas, count(distinct familia_id) as familias from variacoes where tamanho = '"'"'Tamanho Único'"'"'"}'
```

Expected: um JSON com `linhas`/`familias` (provavelmente `0`). Anotar o número no relatório da task. Somente `select` — nunca DDL por aqui (ADR-0043).

- [ ] **Step 2: Ajustar os testes que travam o valor antigo**

Em `src/lib/__tests__/tamanhos.test.ts`:
- linha 9: `expect(TAMANHOS_ROUPA).toEqual(['P', 'M', 'G', 'GG']);`
- acrescentar logo abaixo:
```ts
  // Spike 051 §12: testado contra a API real — não existe guia de tamanhos para "Tamanho Único"
  // nos domínios de vestuário suportados, então publicar com esse valor falha SEMPRE. Sair da
  // lista é sair da whitelist da edge, não só sumir da tela.
  it('não oferece "Tamanho Único" — o ML não publica esse valor', () => {
    expect(TAMANHOS_ROUPA).not.toContain('Tamanho Único');
  });
```
- apagar o `describe('gerarCombinacoes')` inteiro (linhas 37-84) e tirar `gerarCombinacoes`/`LIMITE_VARIACOES_GERADAS` do import (se `LIMITE_VARIACOES_GERADAS` ficar sem uso no arquivo).

Em `supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts:41`:
```ts
    expect(tamanhosValidosParaTipos(['roupa'])).not.toContain('Tamanho Único');
    expect(tamanhosValidosParaTipos(['roupa'])).toContain('GG');
```

Em `supabase/functions/cadastrar-produto/__tests__/processar.test.ts:356`:
```ts
    for (const t of ['P', 'M', 'G', 'GG']) {
```
e acrescentar logo depois do `it` existente:
```ts
  it('org de roupa RECUSA "Tamanho Único" — saiu da lista canônica (Spike 051 §12)', () => {
    const erros = validarTamanhosDaEntrada(comTamanho('Tamanho Único'), ['roupa']);
    expect(erros).toHaveLength(1);
    expect(erros[0].campo).toBe('variacoes[0].tamanho');
  });
```

- [ ] **Step 3: Rodar e confirmar que falham**

Run: `pnpm test src/lib/__tests__/tamanhos.test.ts supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts supabase/functions/cadastrar-produto/__tests__/processar.test.ts`
Expected: FAIL nos 3 arquivos — a lista ainda tem o valor.

- [ ] **Step 4: Remover o valor e os órfãos**

`supabase/functions/_shared/produto/tipos-produto-valores.ts:16-17`:
```ts
/** Conjunto fechado decidido no grilling de 2026-09-18. "Tamanho Único" saiu em 2026-09-19:
 *  o Spike 051 §12 confirmou, com 3 chamadas reais, que o ML não tem guia de tamanhos para esse
 *  valor nos domínios de vestuário suportados — publicar com ele falha sempre. Sair daqui é sair
 *  da whitelist que a edge `cadastrar-produto` valida, não só da tela. */
export const TAMANHOS_ROUPA = ['P', 'M', 'G', 'GG'] as const;
```

`src/lib/tipos-produto.ts:29`:
```ts
    descricao: 'O cadastro ganha Tamanho (P, M, G, GG) como segundo eixo, além da cor.',
```

Em `src/lib/tamanhos.ts`: apagar `Combinacao`, `limparLista`, `contarCombinacoes` e `gerarCombinacoes` (linhas 37-77), mantendo `LIMITE_VARIACOES_GERADAS` (usada por `cadastro-grade.ts` e pelo dialog) com o comentário atualizado para citar `totalDaGrade` em vez de "o cartesiano estoura rápido".

Em `src/components/estoque/linha-variacao-form.tsx`: remover a prop `gruposTamanho` da assinatura e da doc, o bloco `{!!gruposTamanho?.length && (...)}` (linhas 170-193), o import `type GrupoTamanho`, e simplificar `className={cn('grid gap-2', ...)}` para `className="grid gap-2 sm:grid-cols-2"`. **Manter** o campo `tamanho` em `LinhaVariacao`/`novaLinha` — o payload continua carregando-o (`tamanho: null` no cadastro normal, preenchido pela grade).

Run: `rm src/components/estoque/__tests__/linha-variacao-tamanho.test.tsx`

- [ ] **Step 5: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS. Falha em arquivo fora deste diff → suspeitar de teste com data fixa antes de chamar de regressão.

- [ ] **Step 6: Rodar o portão estático completo**

Run: `pnpm preflight:static`
Expected: sem erros (inclui `deno lint`/`deno check` das functions, `tsc -b --force` e `vite build`).

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add -A
/usr/bin/git commit -m "chore(produto): remove Tamanho Único e os orfaos do eixo de grade no dialog normal"
```

---

## Task 12: Nota de amendment no ADR-0166

**Modelo:** `sonnet`. Conteúdo factual (cita ADRs, spike, arquivos) — **nunca `haiku`**, pela regra do CLAUDE.md sobre dado plausível-porém-errado.

**Files:**
- Modify: `docs/decisions/0166-tipo-de-produto-por-organizacao.md` (acrescentar uma seção antes de `## Como reverter`)

**Interfaces:** nenhuma — só documentação.

- [ ] **Step 1: Acrescentar a seção**

```markdown
## Amendment (2026-09-19) — o eixo de grade saiu do dialog de cadastro normal

A decisão original punha Gênero, Tamanho/Numeração e o gerador de variações **dentro** do dialog
de cadastro existente, condicionados a `temEixoTamanho`. Depois de a org piloto cadastrar e
publicar de verdade (uma jaqueta e uma sandália), o dono do produto apontou três problemas: o
formulário misturava perguntas de grade com as de produto simples, preço/custo/dimensão tinham
de ser revisados em cada uma das até 60 linhas, e "Tamanho Único" continuava sendo oferecido.

Fica revisado assim, conforme
`docs/superpowers/specs/2026-09-19-cadastro-grade-roupa-calcado-design.md`:

- O cadastro em grade ganha **tela própria** (`src/components/estoque/dialog-cadastro-grade.tsx`),
  aberta por um segundo botão em Estoque que só aparece para org com tipo habilitado.
  `dialog-cadastro-produto.tsx` volta ao formato de antes deste ADR — sem Gênero, sem Tamanho,
  sem `GeradorVariacoes`, para qualquer org.
- Preço mínimo (líquido), custo e as 4 dimensões passam a ser **preenchidos uma vez** no
  cabeçalho e herdados por linha, com destrava e "Voltar a herdar" por campo. A herança é
  100% de frontend: o payload enviado à edge continua idêntico, campo a campo, por variação.
- `'Tamanho Único'` sai de `TAMANHOS_ROUPA`. O Spike 051 §12 confirmou por chamada real que o ML
  não tem guia de tamanhos para esse valor nos domínios de vestuário suportados — publicar com
  ele falha sempre. Como a lista é a whitelist que a edge `cadastrar-produto` valida, a remoção
  também recusa o valor vindo de aba antiga ou retry, com erro claro.

O que **não** muda: o modelo de dados (`familias.genero`, `variacoes.tamanho`,
`organizations.tipos_produto_habilitados`), a RPC `tipos_produto_da_org()`, a validação de
backend e a publicação com guia de tamanhos (ADR-0167). Nenhuma migration.
```

- [ ] **Step 2: Conferir os links de docs**

Run: `pnpm docs:links`
Expected: sem link quebrado.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/decisions/0166-tipo-de-produto-por-organizacao.md
/usr/bin/git commit -m "docs(adr): amendment no 0166 — grade vira tela propria e Tamanho Unico sai"
```

---

## Fechamento (depois da Task 12)

- [ ] Rodar o portão completo: `pnpm preflight` (~3min37). Expected: PASS.
- [ ] Validação de UI em runtime real antes de qualquer merge (regra do projeto): `ultraqa` + browser-use/playwright-cli em sessão isolada, comparando a tela 1:1 com o que o payload envia. Cobrir: org com 1 tipo, org com os 2 tipos, org com módulo fiscal, e uma grade de 3 cores × 4 tamanhos com 1 override e 1 linha removida na mão.
- [ ] Revisão do Fable sobre o diff acumulado antes do merge.
- [ ] **Não** há Edge Function nem migration alteradas nesta entrega (só `_shared/ml/medidas-valores.ts` e `_shared/ml/size-chart.ts`, que são código compartilhado). Como `_shared/` mudou, **redeployar as functions que importam `size-chart.ts`** e conferir a versão pós-deploy — `size-chart.ts` foi tocado, ainda que sem mudança de comportamento. Levantar a lista com:
  `grep -rln "size-chart" supabase/functions --include=*.ts | grep -v __tests__`
