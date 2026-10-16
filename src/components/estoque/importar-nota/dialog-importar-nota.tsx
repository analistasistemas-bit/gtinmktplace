// ADR-0181 — assistente "Importar nota de compra": arquivo → itens → distribuição → resumo.
// A entrada é gravada de uma vez pela edge `importar-nota-compra`; nada é publicado em marketplace.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useEmpresaFiscal } from '@/hooks/useConfiguracoes';
import { useTiposProdutoHabilitados } from '@/hooks/useTiposProdutoHabilitados';
import { DialogCadastroProduto, type CadastroInicial } from '@/components/estoque/dialog-cadastro-produto';
import { DialogCadastroGrade } from '@/components/estoque/dialog-cadastro-grade';
import { QK } from '@/lib/queries';
import { fetchProdutosEstoqueResumo } from '@/lib/produtos-saldo';
import {
  buscarVinculos, entradasPreviasDaNota, importarNotaCompra, produtosPorGtin, statusDaNota,
} from '@/lib/notas-compra';
import { lerNfe } from '../../../../supabase/functions/_shared/nfe/ler-nfe.ts';
import { definirProduto, estadoInicial, payload, pendencias, podeAvancarEtapa, recusaInicial, type EstadoImportacao } from './estado';
import { prefillCadastro } from './prefill-cadastro';
import { EtapaArquivo, type Recusa } from './etapa-arquivo';
import { EtapaItens } from './etapa-itens';
import { EtapaDistribuicao } from './etapa-distribuicao';
import { EtapaResumo } from './etapa-resumo';

const TITULOS = ['Arquivo da nota', 'Produtos', 'Distribuição', 'Resumo'];

export function DialogImportarNota({ aberto, onFechar, onVerNota }: {
  aberto: boolean;
  onFechar: () => void;
  /** Notas de compra (Task 12) pluga aqui o "Ver nota". */
  onVerNota?: (chave: string) => void;
}) {
  const qc = useQueryClient();
  const { data: empresa } = useEmpresaFiscal();
  const cnpj = empresa?.cnpj ?? '';
  const [etapa, setEtapa] = useState(0);
  const [e, setE] = useState<EstadoImportacao | null>(null);
  const [recusa, setRecusa] = useState<Recusa | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  // "Cadastrar produto novo" (ADR-0181 D-4/D-10). `inicial` é snapshot ESTÁVEL, montado no clique.
  const [cadastro, setCadastro] = useState<{ nItem: number; modo: 'grade' | 'simples'; inicial: CadastroInicial } | null>(null);
  const { data: tiposProduto, isLoading: carregandoTipos } = useTiposProdutoHabilitados();

  const { data: resumo } = useQuery({
    queryKey: QK.produtosEstoqueResumo, queryFn: fetchProdutosEstoqueResumo, enabled: aberto, staleTime: 180_000,
  });
  const produtos = resumo?.produtos ?? [];

  useEffect(() => {
    if (aberto) return;
    setEtapa(0); setE(null); setRecusa(null); setErroLeitura(null); setLendo(false); setCadastro(null);
  }, [aberto]);

  function cadastrarNovo(nItem: number, modo: 'grade' | 'simples') {
    if (!e) return;
    const item = e.itens.find((i) => i.nItem === nItem)!;
    const d = e.decisoes.find((x) => x.nItem === nItem)!;
    setCadastro({ nItem, modo, inicial: prefillCadastro(item, e.nota, d.fator) });
  }

  function aoCadastrar(nItem: number, { codigoPai }: { codigoPai: string }) {
    // Edge antiga (sem `codigoPai` na resposta): o produto foi gravado, mas não dá para vincular.
    if (!codigoPai) { toast.error('Produto cadastrado, mas não foi possível vinculá-lo ao item — escolha-o na lista.'); return; }
    setE((s) => (s ? definirProduto(s, nItem, codigoPai) : s));
    qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
  }

  async function lerArquivo(file: File) {
    setLendo(true); setE(null); setRecusa(null); setErroLeitura(null);
    try {
      const xml = await file.text();
      const r = lerNfe(xml);
      if (!r.ok) { setErroLeitura(r.erro); return; }
      const nota = r.nota;
      const existente = await statusDaNota(nota.chave);
      const msg = recusaInicial(nota, cnpj, existente);
      if (msg) { setRecusa({ mensagem: msg, jaImportada: existente?.status === 'importada', chave: nota.chave }); return; }
      const [vinculos, porGtin, previas] = await Promise.all([
        buscarVinculos(nota.emitenteCnpj),
        produtosPorGtin(nota.itens.map((i) => i.gtin).filter((g): g is string => !!g)),
        entradasPreviasDaNota(nota.chave),
      ]);
      setE(estadoInicial(nota, xml, vinculos, porGtin, previas));
    } catch (err) {
      setErroLeitura(err instanceof Error ? err.message : 'Não foi possível ler a nota.');
    } finally {
      setLendo(false);
    }
  }

  const confirmar = useMutation({
    mutationFn: () => importarNotaCompra(payload(e!)),
    onSuccess: (r) => {
      const n = e!.nota;
      const unidades = e!.decisoes.reduce((s, d) => s + d.distribuicao.reduce((t, l) => t + (l.travada ? 0 : l.quantidade), 0), 0);
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      qc.invalidateQueries({ queryKey: QK.notasCompra });
      qc.invalidateQueries({ queryKey: QK.vinculosFornecedor(n.emitenteCnpj) });
      const tocados = e!.decisoes.flatMap((d) => [d.codigoPai!, ...d.distribuicao.map((l) => l.codigoPai).filter((c): c is string => !!c)]);
      for (const cp of new Set(tocados)) {
        qc.invalidateQueries({ queryKey: QK.variacoesEstoque(cp) });
      }
      if (r.duplicada) toast.info(`Nota ${n.numero} já tinha sido importada — nada foi somado.`);
      else if (!r.pushOk) {
        toast.warning("Estoque gravado, mas o envio aos canais falhou — use 'Reenviar estoque' em Notas de compra.");
      } else toast.success(`Nota ${n.numero} importada · ${unidades} unidades`);
      onFechar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Não foi possível importar a nota.'),
  });

  const semPendencias = !!e && pendencias(e).length === 0;
  const podeAvancar = etapa === 0 ? !!e && !recusa : !!e && podeAvancarEtapa(e, etapa);

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o && !confirmar.isPending) onFechar(); }}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar nota de compra</DialogTitle>
          <DialogDescription>Etapa {etapa + 1} de 4 · {TITULOS[etapa]}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto pr-1">
          {etapa === 0 && (
            <EtapaArquivo e={e} setE={setE} recusa={recusa} erroLeitura={erroLeitura} lendo={lendo}
              onArquivo={lerArquivo} onVerNota={onVerNota} />
          )}
          {etapa === 1 && e && (
            <EtapaItens e={e} setE={setE} produtos={produtos} onCadastrarNovo={cadastrarNovo}
              tiposProduto={tiposProduto} carregandoTipos={carregandoTipos} />
          )}
          {etapa === 2 && e && (
            <EtapaDistribuicao e={e} atualizar={(f) => setE((s) => (s ? f(s) : s))} />
          )}
          {etapa === 3 && e && <EtapaResumo e={e} produtos={produtos} irPara={setEtapa} />}
        </div>

        <DialogFooter>
          {etapa > 0 && <Button variant="outline" onClick={() => setEtapa(etapa - 1)} disabled={confirmar.isPending}>Voltar</Button>}
          {etapa < 3 ? (
            <Button onClick={() => setEtapa(etapa + 1)} disabled={!podeAvancar}>Avançar</Button>
          ) : (
            <Button onClick={() => confirmar.mutate()} disabled={!semPendencias || confirmar.isPending}>
              {confirmar.isPending ? 'Importando…' : 'Confirmar'}
            </Button>
          )}
        </DialogFooter>

        {/* DENTRO do DialogContent da importação: na árvore React do assistente, o Radix trata o
            cadastro como camada aninhada — como irmão, um clique nele contaria como "fora" e
            fecharia a importação (que zera o estado no fechamento). */}
        <DialogCadastroProduto
          aberto={cadastro?.modo === 'simples'} onFechar={() => setCadastro(null)}
          inicial={cadastro?.modo === 'simples' ? cadastro.inicial : undefined} origemNota
          avisoSemGrade={tiposProduto?.length === 0}
          onCadastrado={(r) => cadastro && aoCadastrar(cadastro.nItem, r)}
        />
        <DialogCadastroGrade
          aberto={cadastro?.modo === 'grade'} onFechar={() => setCadastro(null)}
          inicial={cadastro?.modo === 'grade' ? cadastro.inicial : undefined} origemNota
          onCadastrado={(r) => cadastro && aoCadastrar(cadastro.nItem, r)}
        />
      </DialogContent>
    </Dialog>
  );
}
