// ADR-0129: admin adiciona N variações (cores) novas a uma família JÁ PUBLICADA no ML, direto
// da tela Estoque. Monta um lote real de UPDATE (variações vivas clonadas + as novas digitadas
// aqui) e cai no pipeline de UPDATE existente (edge `adicionar-variacoes-familia` →
// `publicar-familias`) — NUNCA passa pela tela Revisão (D-10). Versão SIMPLIFICADA do cadastro
// (`dialog-cadastro-produto.tsx`, ADR-0094): uma etapa só, sem retry manual de foto — a
// idempotência da edge (`chave`/`jaExistia`) já cobre o retry de rede.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';
import { effectiveOrgId, useSupportStore, canWrite } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import { corpoDoErroDaEdge } from '@/lib/edge-erro';
import { fetchFamiliasNaoPublicadas, familiaEmVoo } from '@/lib/estoque-update-status';
import {
  LinhaVariacaoForm, novaLinha, parseNum, erroCampo, type LinhaVariacao,
} from '@/components/estoque/linha-variacao-form';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

type LinhaAddVariacao = LinhaVariacao & { codigo: string };

interface IrmaReferencia {
  peso_gramas: number | null; altura_cm: number | null; largura_cm: number | null; comprimento_cm: number | null;
  custo: number | null; preco: number | null;
}

interface FamiliaCanonicaPrefill {
  id: string;
  variacoes: IrmaReferencia[];
}

// PostgREST: família mais recente por codigo_pai + a 1ª variação como referência de
// peso/dimensões/custo/preço mínimo (D-6 do ADR: campos pré-preenchidos da irmã, editáveis —
// estendido em 2026-08-21 pra também cobrir custo e preço mínimo, que raramente mudam entre
// cores do mesmo produto). O `id` devolvido AQUI é o que a edge espera em `familia_id` — é a
// família CANÔNICA que a tela Estoque conhece, não necessariamente a última publicada (a edge
// resolve a última publicada sozinha a partir do codigo_pai).
async function fetchFamiliaCanonicaPrefill(codigoPai: string): Promise<FamiliaCanonicaPrefill | null> {
  const { data, error } = await supabase
    .from('familias')
    .select('id, variacoes(codigo, peso_gramas, altura_cm, largura_cm, comprimento_cm, custo, preco)')
    .eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as FamiliaCanonicaPrefill | undefined) ?? null;
}

function novaLinhaComPrefill(irma: IrmaReferencia | null): LinhaAddVariacao {
  return {
    ...novaLinha(),
    codigo: '',
    pesoGramas: irma?.peso_gramas != null ? String(irma.peso_gramas) : '',
    alturaCm: irma?.altura_cm != null ? String(irma.altura_cm) : '',
    larguraCm: irma?.largura_cm != null ? String(irma.largura_cm) : '',
    comprimentoCm: irma?.comprimento_cm != null ? String(irma.comprimento_cm) : '',
    custo: irma?.custo != null ? String(irma.custo) : '',
    preco: irma?.preco != null ? String(irma.preco) : '',
  };
}

/** `null` = campo vazio/inválido — mesma conversão defensiva do cadastro (dialog-cadastro-produto.tsx). */
function numOuNull(v: string): number | null {
  const n = parseNum(v);
  return typeof n === 'number' && !Number.isNaN(n) ? n : null;
}

// Todo campo numérico que `erroCampo` valida (mesma lista do cadastro) — usado por `podeSalvar`
// para travar o submit se QUALQUER um, em QUALQUER linha, tiver erro.
const CAMPOS_NUMERICOS = [
  'preco', 'custo', 'estoqueInicial', 'pesoGramas', 'alturaCm', 'larguraCm', 'comprimentoCm',
] as const;

const CODIGO_REGEX = /^\d{1,8}$/;

/** Mesma normalização de `normalizarCodigo8` da edge (1-8 dígitos → 8 com padStart) — usada
 *  aqui só para COMPARAR duplicidade: '123' e '00000123' são o MESMO código no banco
 *  (`(org_id, codigo)` é o que as RPCs de estoque resolvem), então o form não pode deixar
 *  passar essa dupla achando que são SKUs diferentes. */
function normalizarLocal(codigo: string): string | null {
  const c = codigo.trim();
  return CODIGO_REGEX.test(c) ? c.padStart(8, '0') : null;
}

function erroCodigo(codigo: string, todos: string[]): string | null {
  const norm = normalizarLocal(codigo);
  if (!norm) return 'Código deve ter de 1 a 8 dígitos.';
  const normalizados = todos.map(normalizarLocal).filter((x): x is string => x != null);
  if (normalizados.filter((x) => x === norm).length > 1) return 'Código repetido nesta submissão.';
  return null;
}

export function DialogAdicionarVariacao({ produto, aberto, onFechar }: {
  produto: ProdutoEstoqueResumo | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [linhas, setLinhas] = useState<LinhaAddVariacao[]>([]);
  // "Adicionar variação" clicado ao menos uma vez — mesmo padrão blur/tentouSalvar do cadastro.
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // Regenerada só ao FECHAR (padrão do cadastro): a idempotência da edge (`chave`/`jaExistia`)
  // cobre o retry de rede sem duplicar o lote.
  const [chave, setChave] = useState(() => crypto.randomUUID());

  const { data: prefill } = useQuery({
    queryKey: ['familia-canonica-prefill', produto?.codigoPai],
    queryFn: () => fetchFamiliaCanonicaPrefill(produto!.codigoPai),
    enabled: aberto && !!produto,
  });
  const irmaRef = prefill?.variacoes[0] ?? null;

  // Mesma QK da tela Estoque (Task 5/6): cache compartilhado — o banner de "família em voo"
  // abaixo é um pré-check de UI (D-8); a edge revalida de qualquer forma antes de gravar.
  const { data: famRows } = useQuery({
    queryKey: QK.familiasNaoPublicadas,
    queryFn: fetchFamiliasNaoPublicadas,
    enabled: aberto && !!produto,
  });
  const emVoo = !!produto && familiaEmVoo(famRows ?? [], produto.codigoPai);

  // Reset ao abrir/trocar de produto. NÃO depende de `irmaRef`: o prefill chega depois (consulta
  // assíncrona) e um reset disparado por ele apagaria o que o operador já tiver digitado nesse
  // meio-tempo — o efeito abaixo, que só toca campos ainda vazios, cobre o preenchimento tardio.
  useEffect(() => {
    if (!aberto) return;
    setLinhas([novaLinhaComPrefill(null)]);
    setTentouSalvar(false);
  }, [aberto, produto?.codigoPai]);

  // Aplica o prefill de peso/dimensões/custo/preço (D-6) quando ele chega DEPOIS do reset acima
  // — cada grupo só toca campos ainda vazios (pristine), pra nunca sobrescrever o que o operador
  // já tiver digitado. Custo e preço são checados por campo (não em bloco, como os físicos):
  // o operador pode ter digitado só um dos dois antes do prefill chegar.
  useEffect(() => {
    if (!aberto || !irmaRef) return;
    setLinhas((prev) => prev.map((l) => ({
      ...l,
      ...(l.pesoGramas === '' && l.alturaCm === '' && l.larguraCm === '' && l.comprimentoCm === ''
        ? {
          pesoGramas: irmaRef.peso_gramas != null ? String(irmaRef.peso_gramas) : '',
          alturaCm: irmaRef.altura_cm != null ? String(irmaRef.altura_cm) : '',
          larguraCm: irmaRef.largura_cm != null ? String(irmaRef.largura_cm) : '',
          comprimentoCm: irmaRef.comprimento_cm != null ? String(irmaRef.comprimento_cm) : '',
        }
        : {}),
      ...(l.custo === '' && irmaRef.custo != null ? { custo: String(irmaRef.custo) } : {}),
      ...(l.preco === '' && irmaRef.preco != null ? { preco: String(irmaRef.preco) } : {}),
    })));
  }, [aberto, irmaRef]);

  useEffect(() => {
    if (aberto) return;
    setChave(crypto.randomUUID());
  }, [aberto]);

  const codigos = linhas.map((l) => l.codigo);
  // D-4/desvio 5 do plano: foto e estoque inicial > 0 são obrigatórios aqui (diferente do
  // cadastro, onde os dois são opcionais) — cor sem os dois nasceria "zumbi" (nunca publicável).
  const podeSalvar = !!produto && !!prefill && !emVoo && linhas.length > 0
    && linhas.every((l) => !erroCodigo(l.codigo, codigos))
    && linhas.every((l) => l.nome.trim() !== '')
    && linhas.every((l) => CAMPOS_NUMERICOS.every((c) => !erroCampo(c, l[c])))
    && linhas.every((l) => (numOuNull(l.estoqueInicial) ?? 0) > 0)
    && linhas.every((l) => l.foto != null);

  async function salvar() {
    if (!produto || !prefill) return;
    setSalvando(true);
    try {
      if (!canWrite()) throw new Error('Suporte somente leitura.');
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão ou organização.');
      const owner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);

      const variacoes = [];
      for (const l of linhas) {
        const codigo = l.codigo.trim();
        const imagemPath = await uploadFile(
          'imagens', buildStoragePath(owner, chave, `${codigo}-${l.foto!.name}`), l.foto!,
        );
        variacoes.push({
          codigo,
          nome: l.nome.trim(),
          gtin: l.gtin.trim() || null,
          preco: numOuNull(l.preco) ?? 0,
          custo: numOuNull(l.custo),
          estoqueInicial: numOuNull(l.estoqueInicial) ?? 0,
          pesoGramas: numOuNull(l.pesoGramas),
          alturaCm: numOuNull(l.alturaCm),
          larguraCm: numOuNull(l.larguraCm),
          comprimentoCm: numOuNull(l.comprimentoCm),
          imagemPath,
        });
      }

      const { data, error } = await supabase.functions.invoke('adicionar-variacoes-familia', {
        body: { familia_id: prefill.id, chave, variacoes },
      });
      if (error) {
        const detalhe = await corpoDoErroDaEdge(error);
        const conflitos = detalhe?.corpo.conflitos as string[] | undefined;
        throw new Error(conflitos?.length
          ? `${String(detalhe?.corpo.error)} (${conflitos.join(', ')})`
          : String(detalhe?.corpo.error ?? (error as Error).message));
      }
      const r = data as {
        loteId: string; familiaId: string; publicacaoOk: boolean; falhasEstoque: string[]; jaExistia?: boolean;
      };
      qc.invalidateQueries({ queryKey: QK.familiasNaoPublicadas });
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      // Achado 2026-08-21: as linhas novas já existem no banco neste ponto (o INSERT já rodou
      // na edge) — sem isso, a lista expandida do card (fetchVariacoesProduto, QK diferente do
      // resumo acima) ficava presa no cache antigo e o operador via a contagem certa mas a
      // tabela errada.
      qc.invalidateQueries({ queryKey: QK.variacoesEstoque(produto.codigoPai) });
      toast.success('✓ Variações enviadas — atualizando o anúncio');
      if (!r.publicacaoOk) {
        toast.warning('Gravado, mas a publicação não foi disparada — conclua pela tela Lotes.');
      }
      if (r.falhasEstoque.length > 0) {
        toast.warning(`Estoque inicial não aplicado em: ${r.falhasEstoque.join(', ')}. Use "Dar entrada" para corrigir.`);
      }
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao adicionar variação.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o && !salvando) onFechar(); }}>
      {/* sm: obrigatorio: mesmo cuidado de dialog-cadastro-produto.tsx — o default do componente
          é `sm:max-w-sm`, e sobrescrever sem o mesmo prefixo não vence a cascata do
          tailwind-merge (a regra `sm:` do Dialog venceria em qualquer desktop). */}
      <DialogContent className="max-h-[90vh] sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar variação</DialogTitle>
          <DialogDescription>
            {produto?.nomePai}. Monta um lote de atualização real — vai direto para o Mercado
            Livre, sem passar pela Revisão.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          {emVoo && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <span>
                Já existe uma atualização em andamento para este produto. Aguarde concluir na
                tela Lotes.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {linhas.map((l, i) => {
              const erroCod = erroCodigo(l.codigo, codigos);
              const estoqueInvalido = (numOuNull(l.estoqueInicial) ?? 0) <= 0;
              return (
                <div key={l.clientId} className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`addvar-codigo-${l.clientId}`} className="text-xs text-muted-foreground">
                      Código (SKU)<span className="text-destructive"> *</span>
                    </label>
                    <Input
                      id={`addvar-codigo-${l.clientId}`}
                      aria-label={`Código (SKU) da variação ${i + 1}`}
                      className="h-8 text-sm"
                      value={l.codigo}
                      onChange={(e) => setLinhas((prev) => prev.map((x) => (
                        x.clientId === l.clientId ? { ...x, codigo: e.target.value } : x
                      )))}
                    />
                    {/* Sem gate por `tentouSalvar`: o botão trava assim que o código é inválido/
                        repetido, e um clique nele desabilitado nunca chega a setar `tentouSalvar`
                        (mesmo racional do erro de estoque inicial abaixo). */}
                    {l.codigo.trim() !== '' && erroCod && <span className="text-xs text-destructive">{erroCod}</span>}
                  </div>
                  <LinhaVariacaoForm
                    linha={l}
                    indice={i}
                    podeRemover={linhas.length > 1}
                    tentouSalvar={tentouSalvar}
                    fotoObrigatoria
                    onMudar={(patch) => setLinhas((prev) => prev.map((x) => (
                      x.clientId === l.clientId ? { ...x, ...patch } : x
                    )))}
                    onRemover={() => setLinhas((prev) => prev.filter((x) => x.clientId !== l.clientId))}
                  />
                  {/* erroCampo (linha-variacao-form.tsx) só recusa negativo/fracionado — o piso
                      "> 0" é uma regra desta tela (desvio 5 do plano), não do cadastro. Mostra
                      assim que o campo deixa de estar vazio (não atrás de `tentouSalvar`): o
                      botão "Salvar" fica desabilitado neste estado, então um clique nele nunca
                      dispara — sem gate por digitação o operador não veria por que travou. */}
                  {l.estoqueInicial.trim() !== '' && estoqueInvalido && (
                    <span className="text-xs text-destructive">Estoque inicial deve ser maior que zero.</span>
                  )}
                </div>
              );
            })}
          </div>

          <Button
            type="button" variant="outline" size="sm" className="self-start"
            onClick={() => setLinhas((l) => [...l, novaLinhaComPrefill(irmaRef)])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar variação
          </Button>
          <span className="text-xs text-muted-foreground">* obrigatório · foto obrigatória em toda linha</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          {/* Rótulo distinto do botão "Adicionar variação" acima (que só acrescenta uma linha
              nova ao formulário) — os dois com o mesmo texto ambiguizariam `getByRole('button')`. */}
          <Button onClick={() => { setTentouSalvar(true); void salvar(); }} disabled={!podeSalvar || salvando}>
            {salvando ? 'Enviando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
