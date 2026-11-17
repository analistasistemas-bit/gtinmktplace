// ADR-0181 — assistente "Importar nota de compra": arquivo → itens → distribuição → resumo.
// A entrada é gravada de uma vez pela edge `importar-nota-compra`; nada é publicado em marketplace.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useEmpresaFiscal } from '@/hooks/useConfiguracoes';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { useTiposProdutoHabilitados } from '@/hooks/useTiposProdutoHabilitados';
import { DialogCadastroProduto, type CadastroInicial } from '@/components/estoque/dialog-cadastro-produto';
import { DialogCadastroGrade } from '@/components/estoque/dialog-cadastro-grade';
import { QK } from '@/lib/queries';
import { fetchProdutosEstoqueResumo, fetchVariacoesProduto } from '@/lib/produtos-saldo';
import {
  buscarVinculos, entradasPreviasDaNota, importarNotaCompra, produtosCadastradosDaNota, produtosPorGtin, statusDaNota,
  type SugestaoDistribuicao,
} from '@/lib/notas-compra';
import { lerNfe } from '../../../../supabase/functions/_shared/nfe/ler-nfe.ts';
import { aplicarCadastradosDaNota, aplicarSugestaoCadastro, definirProduto, estadoInicial, payload, pendencias, motivoBloqueioEtapa, recusaInicial, type EstadoImportacao } from './estado';
import { prefillCadastro } from './prefill-cadastro';
import { EtapaArquivo, type Recusa } from './etapa-arquivo';
import { EtapaItens } from './etapa-itens';
import { EtapaDistribuicao } from './etapa-distribuicao';
import { EtapaResumo } from './etapa-resumo';
import { CampoPedido, pedidosDaNota, pedidosQueRecebem, preSelecaoNota, useRecebimentoPedido } from '@/components/reposicao/recebimento-pedido';

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
  const { data: modulos } = useModulosHabilitados();
  const [etapa, setEtapa] = useState(0);
  const [e, setE] = useState<EstadoImportacao | null>(null);
  const [recusa, setRecusa] = useState<Recusa | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [conferirFalhou, setConferirFalhou] = useState(false);
  // Consulta de "cadastrados desta nota" em voo: enquanto pendente, nada avança (senão confirma no produto antigo).
  const [conferindo, setConferindo] = useState(false);
  // Guarda de corrida: leitura (geração) e nota atuais. Resposta de leitura antiga ou de diálogo fechado é descartada.
  const leitura = useRef({ geracao: 0, chave: null as string | null });
  // "Cadastrar produto novo" (ADR-0181 D-4/D-10). `inicial` é snapshot ESTÁVEL, montado no clique.
  const [cadastro, setCadastro] = useState<{ nItem: number; modo: 'grade' | 'simples'; inicial: CadastroInicial } | null>(null);
  const { data: tiposProduto, isLoading: carregandoTipos } = useTiposProdutoHabilitados();
  // ADR-0207 §16: pedido que a nota baixa. `undefined` = o operador não mexeu → vale a pré-seleção pelo CNPJ.
  const recebimento = useRecebimentoPedido(aberto);
  const [escolhaPedido, setEscolhaPedido] = useState<string | null | undefined>(undefined);
  const [confirmarCnpj, setConfirmarCnpj] = useState(false);

  const { data: resumo, isLoading: carregandoProdutos, isError: erroProdutos } = useQuery({
    queryKey: QK.produtosEstoqueResumo, queryFn: fetchProdutosEstoqueResumo, enabled: aberto, staleTime: 180_000,
  });
  const produtos = resumo?.produtos ?? [];

  useEffect(() => {
    if (aberto) return;
    leitura.current = { geracao: leitura.current.geracao + 1, chave: null };
    setConferirFalhou(false); setConferindo(false);
    setEtapa(0); setE(null); setRecusa(null); setErroLeitura(null); setLendo(false); setCadastro(null);
    setEscolhaPedido(undefined); setConfirmarCnpj(false);
  }, [aberto]);

  function cadastrarNovo(nItem: number, modo: 'grade' | 'simples') {
    if (!e) return;
    const item = e.itens.find((i) => i.nItem === nItem)!;
    const d = e.decisoes.find((x) => x.nItem === nItem)!;
    setCadastro({ nItem, modo, inicial: prefillCadastro(item, e.nota, d.fator, {
      csosnPadrao: empresa?.csosn_padrao_revenda ?? null, ufEmpresa: empresa?.uf ?? null,
    }) });
  }

  function aoCadastrar(nItem: number, { codigoPai, sugestaoDistribuicao }: { codigoPai: string; sugestaoDistribuicao?: SugestaoDistribuicao | null }) {
    // Edge antiga (sem `codigoPai` na resposta): o produto foi gravado, mas não dá para vincular.
    if (!codigoPai) { toast.error('Produto cadastrado, mas não foi possível vinculá-lo ao item — escolha-o na lista.'); return; }
    // ADR-0181 (emenda 2026-10-17): quantidades da nota digitadas no cadastro chegam já distribuídas.
    // Edge antiga (sem `sugestaoDistribuicao`): só vincula, como antes.
    setE((s) => (s ? aplicarSugestaoCadastro(definirProduto(s, nItem, codigoPai), nItem, sugestaoDistribuicao) : s));
    qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
  }

  // Consulta separada do Promise.all: se falhar, a importação segue (sem retomada) e o operador pode repetir.
  async function conferirCadastrados(chave: string, geracao: number) {
    const atual = () => leitura.current.geracao === geracao && leitura.current.chave === chave;
    setConferindo(true);
    try {
      const lista = await Promise.all((await produtosCadastradosDaNota(chave)).map(async (x) => {
        if (!x.sugestao || x.codigosPai.length !== 1) return x;
        // Sugestão só com códigos que ainda são SKUs do produto (mesma fonte da etapa 3). Sem validar, descarta.
        try {
          const skus = await qc.fetchQuery({
            queryKey: QK.variacoesEstoque(x.codigosPai[0]), queryFn: () => fetchVariacoesProduto(x.codigosPai[0]), staleTime: 30_000,
          });
          return { ...x, codigosValidos: skus.map((v) => v.codigo) };
        } catch {
          return { ...x, sugestao: null };
        }
      }));
      if (!atual()) return;
      setE((s) => (s ? aplicarCadastradosDaNota(s, lista) : s));
      setConferirFalhou(false);
    } catch {
      if (atual()) setConferirFalhou(true);
    } finally {
      if (atual()) setConferindo(false);
    }
  }

  function tentarNovamente() {
    const { geracao, chave } = leitura.current;
    if (chave) { setConferirFalhou(false); void conferirCadastrados(chave, geracao); }
  }

  async function lerArquivo(file: File) {
    const geracao = ++leitura.current.geracao;
    leitura.current.chave = null;
    const atual = () => leitura.current.geracao === geracao;
    setConferirFalhou(false); setConferindo(false);
    setLendo(true); setE(null); setRecusa(null); setErroLeitura(null); setEscolhaPedido(undefined);
    try {
      const xml = await file.text();
      if (!atual()) return;
      const r = lerNfe(xml);
      if (!r.ok) { setErroLeitura(r.erro); return; }
      const nota = r.nota;
      const existente = await statusDaNota(nota.chave);
      if (!atual()) return;
      const msg = recusaInicial(nota, cnpj, existente);
      if (msg) { setRecusa({ mensagem: msg, jaImportada: existente?.status === 'importada', chave: nota.chave }); return; }
      const [vinculos, porGtin, previas] = await Promise.all([
        buscarVinculos(nota.emitenteCnpj),
        produtosPorGtin(nota.itens.map((i) => i.gtin).filter((g): g is string => !!g)),
        entradasPreviasDaNota(nota.chave),
      ]);
      if (!atual()) return;
      setE(estadoInicial(nota, xml, vinculos, porGtin, previas));
      leitura.current.chave = nota.chave;
      void conferirCadastrados(nota.chave, geracao);
    } catch (err) {
      if (atual()) setErroLeitura(err instanceof Error ? err.message : 'Não foi possível ler a nota.');
    } finally {
      if (atual()) setLendo(false);
    }
  }

  // Pedidos abertos com algum SKU da distribuição; pré-seleciona o do fornecedor do CNPJ emitente (o operador troca).
  // Pedido de fornecedor com outro CNPJ nem aparece (a nota de B nunca baixa A).
  const opcoesPedido = pedidosDaNota(
    pedidosQueRecebem(recebimento.pedidos, e ? e.decisoes.flatMap((d) => d.distribuicao.map((l) => l.codigo)) : []),
    e?.nota.emitenteCnpj ?? '');
  const pedidoId = escolhaPedido === undefined ? (e ? preSelecaoNota(opcoesPedido, e.nota.emitenteCnpj) : null) : escolhaPedido;
  const pedidoSel = opcoesPedido.find((p) => p.id === pedidoId) ?? null;
  const pedidoNota = pedidoSel?.id ?? null;

  const confirmar = useMutation({
    mutationFn: ({ pedido, vincularCnpj }: { pedido: string | null; vincularCnpj: boolean }) => importarNotaCompra({
      ...payload(e!), ...(pedido ? { pedidoCompraId: pedido } : {}), ...(pedido && vincularCnpj ? { vincularCnpj: true as const } : {}),
    }),
    onSuccess: (r, { pedido }) => {
      if (pedido && !r.duplicada) void recebimento.aposEntrada(pedido);
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
  const aguardando = !!e && conferindo ? 'Conferindo produtos já cadastrados desta nota…' : null;
  const bloqueio = aguardando ?? (e && etapa > 0 ? motivoBloqueioEtapa(e, etapa) : null);
  const podeAvancar = etapa === 0 ? !!e && !recusa && !aguardando : !!e && !bloqueio;

  return (
    <>
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
              tiposProduto={tiposProduto} carregandoTipos={carregandoTipos}
              conferirFalhou={conferirFalhou} onTentarNovamente={tentarNovamente}
              carregandoProdutos={carregandoProdutos} erroProdutos={erroProdutos}
              fiscalAtivo={!!modulos?.includes('fiscal')} csosnPadrao={empresa?.csosn_padrao_revenda ?? null} />
          )}
          {etapa === 2 && e && (
            <EtapaDistribuicao e={e} atualizar={(f) => setE((s) => (s ? f(s) : s))} />
          )}
          {etapa === 3 && e && <EtapaResumo e={e} produtos={produtos} irPara={setEtapa} />}
          {etapa === 3 && semPendencias && opcoesPedido.length > 0 && (
            <div className="mt-4"><CampoPedido opcoes={opcoesPedido} valor={pedidoNota} onChange={setEscolhaPedido} /></div>
          )}
        </div>

        <DialogFooter>
          {(etapa < 3 || aguardando) && bloqueio && <p className="mr-auto self-center text-sm text-muted-foreground">{bloqueio}</p>}
          {etapa > 0 && <Button variant="outline" onClick={() => setEtapa(etapa - 1)} disabled={confirmar.isPending}>Voltar</Button>}
          {etapa < 3 ? (
            <Button onClick={() => setEtapa(etapa + 1)} disabled={!podeAvancar}>Avançar</Button>
          ) : (
            <Button
              onClick={() => (pedidoSel && !pedidoSel.fornecedor.cnpj
                ? setConfirmarCnpj(true)
                : confirmar.mutate({ pedido: pedidoNota, vincularCnpj: false }))}
              disabled={!semPendencias || !!aguardando || confirmar.isPending}
            >
              {confirmar.isPending ? 'Importando…' : 'Confirmar'}
            </Button>
          )}
        </DialogFooter>

        {/* DENTRO do DialogContent da importação: na árvore React do assistente, o Radix trata o
            cadastro como camada aninhada — como irmão, um clique nele contaria como "fora" e
            fecharia a importação (que zera o estado no fechamento). */}
        {/* Fornecedor do pedido sem CNPJ: a nota grava o CNPJ do emitente nele para sempre — só com confirmação. */}
        <AlertDialog open={confirmarCnpj && !!pedidoSel && !!e} onOpenChange={setConfirmarCnpj}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Identificar o fornecedor pelo CNPJ?</AlertDialogTitle>
              <AlertDialogDescription>
                O fornecedor {pedidoSel?.fornecedor.nome} passa a ser identificado pelo CNPJ {e?.nota.emitenteCnpj} ({e?.nota.emitenteNome}). Confirmar?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmarCnpj(false); confirmar.mutate({ pedido: pedidoNota, vincularCnpj: true }); }}>
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
    {recebimento.dialogoSaldo}
    </>
  );
}
