// ADR-0207 / spec 2026-11-16-reposicao §2 a §7: tela de Reposição, aba Sugestões.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PackageCheck, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { diaBRT } from '@/lib/calendario-brt';
import { usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import { coresForaDeLinha, familiaForaDeLinha, montarVisao, passaUrgencia, useReposicao, type FamiliaVisao, type FiltroUrgencia, type SkuVisao } from '@/hooks/useReposicao';
import { AvisoLoja } from '@/components/reposicao/aviso-loja';
import { CardsUrgencia } from '@/components/reposicao/cards-urgencia';
import { ConfigInicial } from '@/components/reposicao/config-inicial';
import { ListaFamilias, type AcoesLista } from '@/components/reposicao/lista-familias';
import { BarraRascunho } from '@/components/reposicao/barra-rascunho';
import { SheetPedido } from '@/components/reposicao/sheet-pedido';
import { AbaPedidos, type AcoesPedidos } from '@/components/reposicao/aba-pedidos';

const FILTROS: Record<FiltroUrgencia, string> = {
  precisa: 'Precisam de reposição', ruptura: 'Ruptura', vai_faltar: 'Vai faltar', pedir_agora: 'Pedir agora',
  comprar: 'Com sugestão de compra', em_dia: 'Em dia',
};
const ehFiltro = (v: string | null): v is FiltroUrgencia => !!v && v in FILTROS;
const TODOS = '__todos__';

const falhou = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar agora.');

function Carregando() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando a reposição">
      <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
    </div>
  );
}

export default function Reposicao() {
  const r = useReposicao();
  // Config e múltiplo valem para a org inteira: só quem aprova pedido muda (a edge também recusa).
  const admin = usePodeExecutarOperacao();
  const [params] = useSearchParams();
  const produto = params.get('produto');
  const [aba, setAba] = useState('sugestoes');
  const [busca, setBusca] = useState('');
  const [fornecedor, setFornecedor] = useState(TODOS);
  // Fora de linha (marcado no Estoque) fica escondido; o filtro mostra tudo esmaecido, só para consulta.
  const [mostrarFora, setMostrarFora] = useState(false);
  const [urgencia, setUrgencia] = useState<FiltroUrgencia>(() => (ehFiltro(params.get('urgencia')) ? params.get('urgencia') as FiltroUrgencia : 'precisa'));
  const [expandidos, setExpandidos] = useState<Set<string>>(() => new Set(produto ? [produto] : []));
  const [ajustando, setAjustando] = useState(false);
  const [pedidoAberto, setPedidoAberto] = useState<string | null>(null);
  const hoje = diaBRT(Date.now());

  const visao = useMemo(() => (r.data?.resultado ? montarVisao(r.data, hoje) : null), [r.data, hoje]);

  // Porta de entrada pelo selo do Estoque: leva a linha à vista.
  useEffect(() => {
    if (produto && visao) document.getElementById(`familia-${produto}`)?.scrollIntoView({ block: 'start' });
  }, [produto, !!visao]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(() => {
    if (!visao) return [];
    const q = busca.trim().toLocaleLowerCase('pt-BR');
    // Linha aberta fica na lista: Não repor (tamanho) pode levar a família a "Em dia", e a reversão é na mesma tela.
    // Fora de linha não: só aparece com o filtro, que o mostra qualquer que seja a urgência escolhida.
    return visao.familias.filter((f) => mostrarFora || !familiaForaDeLinha(f)).filter((f) => f.codigoPai === produto || expandidos.has(f.codigoPai) || (
      (passaUrgencia(f, urgencia) || (mostrarFora && (familiaForaDeLinha(f) || coresForaDeLinha(f).size > 0)))
      && (fornecedor === TODOS || f.fornecedor.nome === fornecedor)
      && (!q || f.nome.toLocaleLowerCase('pt-BR').includes(q) || f.codigoPai.includes(q) || f.skus.some((s) => s.tela.codigo.includes(q)))
    ));
  }, [visao, busca, fornecedor, urgencia, produto, expandidos, mostrarFora]);

  const alternar = (pai: string) => setExpandidos((s) => {
    const n = new Set(s);
    if (!n.delete(pai)) n.add(pai);
    return n;
  });

  const salvarConfig = async (c: { prazo: number; cobertura: number }) => {
    try { await r.salvarConfig(c); setAjustando(false); } catch (e) { falhou(e); }
  };
  const acoes: AcoesLista = {
    adicionar: async (f: FamiliaVisao) => {
      // Só o que tem a pedir e não está em Não repor: quantidade 0 apagaria item que outro membro pôs no rascunho.
      const itens = f.skus.filter((s) => s.sug.pedir > 0 && !s.tela.naoReporId)
        .map((s) => ({ codigo: s.tela.codigo, codigoPai: f.codigoPai, quantidade: s.sug.pedir, sugerida: s.sug.pedir }));
      try {
        await r.salvarRascunho({ fornecedorNome: f.fornecedor.nome, itens });
        toast.success(`Adicionado ao rascunho de ${f.fornecedor.nome}.`);
      } catch (e) { falhou(e); }
    },
    definirMultiplo: admin ? async (p) => {
      try { await r.definirMultiplo(p); toast.success('Múltiplo de compra salvo.'); } catch (e) { falhou(e); }
    } : undefined,
  };
  const acoesPedidos: AcoesPedidos = {
    onAbrir: setPedidoAberto,
    onEncerrar: async (pedidoId) => {
      try { await r.encerrarSaldo({ pedidoId }); toast.success('Saldo encerrado.'); } catch (e) { falhou(e); }
    },
    onReabrir: async (pedidoId, codigo) => {
      try { await r.reabrirSaldo({ pedidoId, codigos: [codigo] }); toast.success('Saldo reaberto: o item volta a vir.'); } catch (e) { falhou(e); }
    },
  };
  const ctx = {
    prazo: r.data?.config?.prazo ?? 0, cobertura: r.data?.config?.cobertura ?? 0, hoje, pendente: r.pendente,
    onRemoverNaoRepor: async (id: string) => { try { await r.removerNaoRepor(id); } catch (e) { falhou(e); } },
    onNaoRepor: async (s: SkuVisao) => {
      try { await r.naoRepor({ escopo: 'sku', codigoPai: s.tela.codigoPai, codigo: s.tela.codigo }); } catch (e) { falhou(e); }
    },
    onIncluirCompletar: async (f: FamiliaVisao, s: SkuVisao) => {
      const n = s.sug.completarGrade;
      try {
        await r.salvarRascunho({ fornecedorNome: f.fornecedor.nome, itens: [{ codigo: s.tela.codigo, codigoPai: f.codigoPai, quantidade: n, sugerida: n }] });
        toast.success(`Adicionado ao rascunho de ${f.fornecedor.nome}.`);
      } catch (e) { falhou(e); }
    },
  };

  const config = r.data?.config;
  let corpo: React.ReactNode;
  if (r.isLoading) corpo = <Carregando />;
  // Erro num refetch de fundo mantém os dados na tela; o estado de erro é só sem dados.
  else if (!r.data) {
    corpo = (
      <EmptyState title="Não foi possível carregar a reposição." description={r.error instanceof Error ? r.error.message : undefined}
        action={<Button variant="outline" onClick={() => void r.refetch()}>Tentar de novo</Button>} />
    );
  } else if (!config || !visao) {
    corpo = <ConfigInicial onSalvar={salvarConfig} salvando={r.pendente} somenteLeitura={!admin} />;
  } else {
    const filtrado = urgencia !== 'precisa' || fornecedor !== TODOS || busca.trim() !== '' || mostrarFora;
    corpo = (
      <Tabs value={aba} onValueChange={setAba} className="flex flex-col gap-5">
        {r.isError && (
          <p role="status" className="text-sm text-muted-foreground">Não foi possível atualizar agora; mostrando os últimos dados.</p>
        )}
        <TabsList className="group-data-horizontal/tabs:h-auto md:group-data-horizontal/tabs:h-8">
          <TabsTrigger value="sugestoes" className="min-h-11 md:min-h-0">Sugestões</TabsTrigger>
          <TabsTrigger value="pedidos" className="min-h-11 md:min-h-0">Pedidos</TabsTrigger>
        </TabsList>
        {aba === 'pedidos' ? (
          <AbaPedidos pedidos={[...r.data.rascunhos, ...r.data.pedidos]} skus={r.data.skus} familias={r.data.familias} hoje={hoje}
            acoes={acoesPedidos} pendente={r.pendente} />
        ) : visao.semVendas ? (
          <EmptyState icon={PackageCheck} title="Nenhuma venda nos últimos 60 dias. Assim que vender, a reposição aparece aqui." />
        ) : (
          <>
            {visao.avisoLoja !== null && <AvisoLoja pct={visao.avisoLoja} />}
            <CardsUrgencia cards={visao.cards} ativo={urgencia} onFiltro={setUrgencia} ocultarVendaPerdida={visao.avisoLoja !== null} />
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="relative md:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…"
                  aria-label="Buscar produto" className="h-11 pl-8 md:h-9" />
              </div>
              <Select value={fornecedor} onValueChange={setFornecedor}>
                <SelectTrigger className="w-full data-[size=default]:h-11 md:w-52 md:data-[size=default]:h-9" aria-label="Fornecedor"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os fornecedores</SelectItem>
                  {visao.fornecedores.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={urgencia} onValueChange={(v) => setUrgencia(v as FiltroUrgencia)}>
                <SelectTrigger className="w-full data-[size=default]:h-11 md:w-56 md:data-[size=default]:h-9" aria-label="Urgência"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FILTROS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
                <Switch id="mostrar-fora-de-linha" checked={mostrarFora} onCheckedChange={setMostrarFora} />
                <label htmlFor="mostrar-fora-de-linha">Mostrar fora de linha</label>
              </div>
              <span className="text-caption md:ml-auto">Ordenado por urgência</span>
            </div>
            {lista.length ? (
              <ListaFamilias familias={lista} expandidos={expandidos} onAlternar={alternar} ctx={ctx} acoes={acoes} rascunhos={r.data.rascunhos} mostrarForaDeLinha={mostrarFora} />
            ) : filtrado ? (
              <EmptyState title="Nenhum produto com esse filtro." />
            ) : (
              <EmptyState icon={PackageCheck} title="Nada para pedir hoje." />
            )}
          </>
        )}
        {/* Na aba Pedidos o rascunho já está na lista; a barra só cobriria a dica do último pedido. */}
        {aba === 'sugestoes' && <BarraRascunho rascunhos={r.data.rascunhos} skus={r.data.skus} onRevisar={setPedidoAberto} />}
        <SheetPedido pedidoId={pedidoAberto} data={r.data} hoje={hoje} acoes={r} onFechar={() => setPedidoAberto(null)} />
      </Tabs>
    );
  }

  return (
    // Folga no celular para o botão flutuante "Rascunhos (N)" (só na aba Sugestões) não cobrir a última linha.
    <div className={`flex flex-col gap-4 p-4 sm:p-6 ${aba === 'sugestoes' && r.data?.rascunhos.length ? 'pb-24 md:pb-6' : ''}`}>
        <PageHeader
          className="mb-0"
          title="Reposição"
          subtitle="O que pedir hoje e quanto, por fornecedor."
          actions={config && (
            <div className="flex items-center gap-2 text-sm">
              <span className="tabular-nums text-muted-foreground">Prazo {config.prazo}d · Cobertura {config.cobertura}d</span>
              <Popover open={ajustando} onOpenChange={setAjustando}>
                <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-11 md:h-7">Ajustar</Button></PopoverTrigger>
                <PopoverContent align="end" className="w-auto">
                  <ConfigInicial compacto inicial={config} onSalvar={salvarConfig} salvando={r.pendente} somenteLeitura={!admin} />
                </PopoverContent>
              </Popover>
            </div>
          )}
        />
      {corpo}
    </div>
  );
}
