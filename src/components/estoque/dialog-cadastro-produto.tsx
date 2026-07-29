// E6b (ADR-0094, D-1/D-3): cadastro manual de produto, em duas etapas.
// Etapa 1 grava família + variações (a edge é a autoridade da validação); etapa 2 sobe as
// fotos, que só podem existir depois que família e variações têm id.
//
// O cadastro NÃO publica nada — a publicação continua sendo um ato explícito na Revisão.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { effectiveOrgId, useSupportStore, canWrite } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import {
  cadastrarProduto, uploadFotoProduto, ProdutoJaExisteError,
  type ResultadoCadastro,
} from '@/lib/produtos-saldo';
import type { ProdutoEntrada, VariacaoEntrada } from '@/lib/produto-entrada';

type LinhaVariacao = {
  codigo: string; nome: string; gtin: string;
  preco: string; custo: string; estoqueInicial: string;
  pesoGramas: string; alturaCm: string; larguraCm: string; comprimentoCm: string;
};

const LINHA_VAZIA: LinhaVariacao = {
  codigo: '', nome: '', gtin: '', preco: '', custo: '', estoqueInicial: '',
  pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '',
};

function num(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function montarPayload(
  pai: { codigoPai: string; nomePai: string; descricaoPai: string; unidade: string; fornecedor: string; origem: 'nacional' | 'importado' },
  linhas: LinhaVariacao[],
): ProdutoEntrada {
  const variacoes: VariacaoEntrada[] = linhas.map((l) => ({
    codigo: l.codigo.trim(),
    nome: l.nome.trim() || null,
    gtin: l.gtin.trim() || null,
    preco: num(l.preco) ?? 0,
    custo: num(l.custo),
    estoqueInicial: num(l.estoqueInicial),
    pesoGramas: num(l.pesoGramas),
    alturaCm: num(l.alturaCm),
    larguraCm: num(l.larguraCm),
    comprimentoCm: num(l.comprimentoCm),
  }));
  return {
    codigoPai: pai.codigoPai.trim(),
    nomePai: pai.nomePai.trim(),
    descricaoPai: pai.descricaoPai.trim() || null,
    unidade: pai.unidade.trim() || null,
    fornecedor: pai.fornecedor.trim() || null,
    origem: pai.origem,
    variacoes,
  };
}

export function DialogCadastroProduto({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [codigoPai, setCodigoPai] = useState('');
  const [nomePai, setNomePai] = useState('');
  const [descricaoPai, setDescricaoPai] = useState('');
  const [unidade, setUnidade] = useState('UN');
  const [fornecedor, setFornecedor] = useState('');
  // Sem default silencioso: origem define a alíquota de imposto (ADR-0055) e o operador
  // precisa escolher. `null` mantém o botão de salvar travado.
  const [origem, setOrigem] = useState<'nacional' | 'importado' | null>(null);
  const [linhas, setLinhas] = useState<LinhaVariacao[]>([{ ...LINHA_VAZIA }]);

  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCadastro | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  useEffect(() => {
    if (aberto) return;
    setCodigoPai(''); setNomePai(''); setDescricaoPai(''); setUnidade('UN'); setFornecedor('');
    setOrigem(null); setLinhas([{ ...LINHA_VAZIA }]); setResultado(null);
  }, [aberto]);

  const podeSalvar = !!codigoPai.trim() && !!nomePai.trim() && !!origem
    && linhas.length > 0
    && linhas.every((l) => l.codigo.trim() && (num(l.preco) ?? 0) > 0);

  async function salvar() {
    if (!origem) return;
    setSalvando(true);
    try {
      const r = await cadastrarProduto(montarPayload(
        { codigoPai, nomePai, descricaoPai, unidade, fornecedor, origem }, linhas,
      ));
      setResultado(r);
      qc.invalidateQueries({ queryKey: ['produtos-saldo'] });
      if (r.filaOk && r.falhasEstoque.length === 0) toast.success('✓ Produto cadastrado');
    } catch (e) {
      if (e instanceof ProdutoJaExisteError) {
        toast.error(e.message, {
          action: { label: 'Abrir na Revisão', onClick: () => navigate(`/revisao/${e.loteId}`) },
        });
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

  async function subirFoto(arquivo: File, alvo: Parameters<typeof uploadFotoProduto>[3]) {
    if (!resultado) return;
    setEnviandoFoto(true);
    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão ou organização.');
      if (!canWrite()) throw new Error('Suporte somente leitura.');
      const owner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);
      await uploadFotoProduto(owner, resultado.loteId, arquivo, alvo);
      toast.success('✓ Foto enviada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar a foto.');
    } finally {
      setEnviandoFoto(false);
    }
  }

  const pendencias = resultado && (!resultado.filaOk || resultado.falhasEstoque.length > 0);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      {/* sm: obrigatorio: o default do componente e `sm:max-w-sm`; sobrescrever com
          `max-w-4xl` sem o mesmo prefixo nao vence a cascata (tailwind-merge trata como
          grupos diferentes) e o dialog renderiza com 384px em qualquer desktop. */}
      <DialogContent className="max-h-[90vh] sm:max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{resultado ? 'Fotos do produto' : 'Cadastrar produto'}</DialogTitle>
          <DialogDescription>
            {resultado
              ? 'Envie a capa do produto e uma foto por variação. Depois é só ir para a Revisão.'
              : 'O cadastro não publica nada — a publicação continua sendo feita na Revisão.'}
          </DialogDescription>
        </DialogHeader>

        {!resultado ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cad-codigo" className="text-sm font-medium">Código do produto (PAI)</label>
                <Input id="cad-codigo" value={codigoPai} onChange={(e) => setCodigoPai(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cad-nome" className="text-sm font-medium">Nome</label>
                <Input id="cad-nome" value={nomePai} onChange={(e) => setNomePai(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cad-desc" className="text-sm font-medium">Descrição</label>
              <Textarea id="cad-desc" rows={3} value={descricaoPai} onChange={(e) => setDescricaoPai(e.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cad-unidade" className="text-sm font-medium">Unidade</label>
                <Input id="cad-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cad-fornecedor" className="text-sm font-medium">Fornecedor</label>
                <Input id="cad-fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Origem</span>
                <div className="flex items-center gap-4 pt-1.5">
                  {(['nacional', 'importado'] as const).map((o) => (
                    <label key={o} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio" name="origem" value={o}
                        checked={origem === o} onChange={() => setOrigem(o)}
                      />
                      {o === 'nacional' ? 'Nacional' : 'Importado'}
                    </label>
                  ))}
                </div>
                {!origem && (
                  <span className="text-xs text-muted-foreground">Define a alíquota de imposto — obrigatório.</span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Variações</span>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => setLinhas((l) => [...l, { ...LINHA_VAZIA }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar variação
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      {['SKU', 'Cor / nome', 'GTIN', 'Preço', 'Custo', 'Estoque', 'Peso (g)', 'Alt (cm)', 'Larg (cm)', 'Comp (cm)', ''].map((h) => (
                        <th key={h} className="p-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l, i) => (
                      <tr key={i} className="border-t">
                        {(['codigo', 'nome', 'gtin', 'preco', 'custo', 'estoqueInicial', 'pesoGramas', 'alturaCm', 'larguraCm', 'comprimentoCm'] as const).map((campo) => (
                          <td key={campo} className="p-1">
                            <Input
                              className="h-8 min-w-20 text-xs"
                              value={l[campo]}
                              onChange={(e) => setLinhas((prev) => prev.map((x, j) => (
                                j === i ? { ...x, [campo]: e.target.value } : x
                              )))}
                            />
                          </td>
                        ))}
                        <td className="p-1">
                          <Button
                            type="button" variant="ghost" size="sm"
                            disabled={linhas.length === 1}
                            onClick={() => setLinhas((prev) => prev.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Cadastro parcial NUNCA é reportado como sucesso: o operador seguiria para a
                Revisão achando que está tudo certo. */}
            {!resultado.filaOk && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  O produto foi cadastrado, mas o enriquecimento por IA não foi enfileirado.
                  Sem isso ele não fica pronto para publicar.
                  <div className="mt-2">
                    <Button size="sm" onClick={() => reprocessar(resultado.familiaId)}>Reprocessar</Button>
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

            {!pendencias && (
              <>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Fotos do produto</span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(['capa', 'capa2', 'capa3'] as const).map((tipo) => (
                      <label key={tipo} className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {tipo === 'capa' ? 'Capa' : tipo === 'capa2' ? 'Capa 2' : 'Capa 3'}
                        <Input
                          type="file" accept="image/*" disabled={enviandoFoto}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) subirFoto(f, { tipo, familiaId: resultado.familiaId });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Foto por variação</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {resultado.variacoes.map((v) => (
                      <label key={v.id} className="flex flex-col gap-1 text-xs text-muted-foreground">
                        <span className="font-mono">{v.codigo}</span>
                        <Input
                          type="file" accept="image/*" disabled={enviandoFoto}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) subirFoto(f, { tipo: 'variacao', variacaoId: v.id });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {!resultado ? (
            <>
              <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
              <Button onClick={salvar} disabled={!podeSalvar || salvando}>
                {salvando ? 'Cadastrando…' : 'Cadastrar'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onFechar}>Fechar</Button>
              <Button
                disabled={!!pendencias || enviandoFoto}
                onClick={() => { onFechar(); navigate(`/revisao/${resultado.loteId}`); }}
              >
                Ir para a Revisão
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
