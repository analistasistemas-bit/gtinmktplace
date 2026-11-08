// ADR-0174 — preview de "Aderir"/"Sair" no detalhe da campanha; reutilizado pelo Reverter.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import type { TipoPromocaoOperavel } from '@/lib/operacoes';
import { fmtBRL, fmtBRLSemSimbolo } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import { cn } from '@/lib/utils';
import {
  montarPreview, parsePreco, precisaConfirmarRisco, semaforoNoPreco,
  type AcaoPromocao, type LinhaPreview,
} from '@/lib/operacoes';
import { ehOfertaFixa, PRECO_MIN_PROMOCAO, type ItemPromocao } from '@/lib/promocoes';
import { AVISO_DESCONTO, MAX_SIMULAR, descontoInvalido, precoAlvo, resumoLucro, type ModoAlvo, type ResumoLucro } from '@/lib/promocao-simulacao';
import { ErroOperacao, useCriarOperacao, usePodeExecutarOperacao, useSimularPrecos, type MarcaSugestao } from '@/hooks/useOperacoes';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SEMAFORO_UI } from './contagem-semaforo';
import { DetalheRecebe } from './detalhe-recebe';

type Exato = ResumoLucro & { preco: number; semaforo: LinhaPreview['semaforo'] };
interface LinhaEditavel extends LinhaPreview {
  precoTexto: string;
  motivoBloqueio?: string;
  motivoErro?: string;
  /** Conta calculada no servidor NESTE preço; só vale enquanto o preço da linha for o mesmo. */
  exato?: Exato | null;
  avisoCalculo?: string;
}

const ESPERA_DIGITACAO_MS = 500;
const formatarInput = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ','));
const centavos = (n: number) => Math.round(n * 100);
const exatoVale = (l: LinhaEditavel) => l.exato != null && l.preco != null && centavos(l.exato.preco) === centavos(l.preco);

function aplicarPreco(l: LinhaEditavel, texto: string, itens: ItemPromocao[]): LinhaEditavel {
  const preco = parsePreco(texto);
  const original = itens.find((i) => i.ml_item_id === l.ml_item_id);
  // Achado Codex: voltou a um preço já calculado no servidor → o semáforo é o do servidor, não a estimativa local.
  const doServidor = l.exato != null && preco != null && centavos(l.exato.preco) === centavos(preco) ? l.exato.semaforo : null;
  const semaforo = doServidor ?? (original ? semaforoNoPreco(original.projecao, preco) : l.semaforo);
  return { ...l, preco, precoTexto: texto, semaforo, motivoErro: undefined, avisoCalculo: undefined };
}

function construirLinhas(
  acao: AcaoPromocao, tipo: TipoPromocaoOperavel, itens: ItemPromocao[], naoRevertiveis?: Map<string, string>, simulados?: Map<string, number>,
): LinhaEditavel[] {
  const porId = new Map(itens.map((i) => [i.ml_item_id, i]));
  return montarPreview(acao, tipo, itens, simulados).map((l) => {
    const motivoBloqueio = naoRevertiveis?.get(l.ml_item_id);
    // A projeção do item já é a do servidor no preço avaliado (sugerido, ou o simulado na tela): de graça.
    const it = porId.get(l.ml_item_id);
    const r = it?.preco_avaliado != null ? resumoLucro(it, { preco: it.preco_avaliado, projecao: it.projecao, pior_semaforo: it.pior_semaforo }) : null;
    const exato = r && it?.preco_avaliado != null ? { preco: it.preco_avaliado, ...r, semaforo: it.pior_semaforo } : null;
    return { ...l, marcado: motivoBloqueio ? false : l.marcado, motivoBloqueio, precoTexto: formatarInput(l.preco), exato };
  });
}

function textoRisco(vermelho: number, indisponivel: number): string {
  const partes: string[] = [];
  if (vermelho > 0) partes.push(`${vermelho} abaixo do custo`);
  if (indisponivel > 0) partes.push(`${indisponivel} sem líquido`);
  return partes.join(' e ');
}

export function PreviewOperacao({ acao, tipo, promocaoId, promocaoNome, itens, origemId, aberto, onClose, onSucesso, naoRevertiveis, simulados, sugestao, passo, aoConcluir }: {
  acao: AcaoPromocao; tipo: TipoPromocaoOperavel; promocaoId: string; promocaoNome: string; itens: ItemPromocao[];
  origemId?: string | null; aberto: boolean; onClose: () => void;
  /** Achado 2 (revisão): só a criação com sucesso limpa a seleção de quem chamou — fechar o
   *  sheet (X, Esc, overlay) não pode apagar a seleção que o operador fez nas duas abas. */
  onSucesso?: () => void; naoRevertiveis?: Map<string, string>;
  /** Preço escolhido na simulação (emenda 2026-11-03); os itens já chegam com a projeção do servidor nesse preço. */
  simulados?: Map<string, number>;
  /** Marcação de origem quando a adesão nasce de uma sugestão (ADR-0194 D-9). */
  sugestao?: MarcaSugestao;
  /** Sequência de campanhas (ADR-0194, emenda 2026-11-04): posição desta confirmação. */
  passo?: { atual: number; total: number };
  /** Há próxima campanha: ao criar a operação, segue para ela em vez de fechar e ir para Operações. */
  aoConcluir?: () => void;
}) {
  const podeExecutar = usePodeExecutarOperacao();
  const criar = useCriarOperacao();
  const navigate = useNavigate();
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [confirmadoRisco, setConfirmadoRisco] = useState(false);

  // Achado Codex: cálculo pendente de uma abertura anterior não toca as linhas da nova (nem segue para o próximo lote).
  const geracao = useRef(0);
  const digitando = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Fechou o painel: nada pendente segue calculando nem avisa de um painel que não existe mais.
  useEffect(() => {
    const timers = digitando.current;
    return () => { geracao.current++; timers.forEach(clearTimeout); };
  }, []);
  // Reabrir com preview novo (item mudou, ou trocou o grupo aderir/sair): recomeça do zero.
  useEffect(() => {
    geracao.current++;
    digitando.current.forEach(clearTimeout);
    if (!aberto) return;
    const novas = construirLinhas(acao, tipo, itens, naoRevertiveis, simulados);
    setLinhas(novas);
    setConfirmadoRisco(false);
    // Achado Codex P2 (alterar preço): preço inicial sem cálculo válido (Reverter, simulação parcial) já abre
    // calculando no servidor — nunca mostra o lucro de outro preço.
    // Convite de outro horário (Relâmpago): a projeção gravada é do preço participando → calcula no servidor também.
    const convites = new Set(itens.filter((i) => i.convite_aberto).map((i) => i.ml_item_id));
    if (podeEditarPreco) void calcularExato(novas.filter((l) => l.marcado || convites.has(l.ml_item_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomeça só quando o preview muda (podeEditarPreco deriva de acao/tipo)
  }, [aberto, acao, tipo, itens, naoRevertiveis, simulados]);

  // Alterar preço (emenda 2026-11-03): só campanhas tradicionais aceitam PUT do deal_price.
  const podeEditarPreco = (acao === 'aderir' && (tipo === 'DEAL' || tipo === 'LIGHTNING')) || (acao === 'alterar_preco' && tipo === 'DEAL');
  const originalDe = (id: string) => itens.find((i) => i.ml_item_id === id)?.preco_original ?? null;
  const detalhe = (l: LinhaEditavel) => {
    const it = itens.find((i) => i.ml_item_id === l.ml_item_id);
    return <DetalheRecebe r={l.exato!} preco={l.exato!.preco} original={it?.preco_original ?? null} listingType={it?.listing_type_id} variasCores={(it?.projecao.length ?? 0) > 1} />;
  };
  const acimaDoOriginal = (l: LinhaEditavel) => acao === 'alterar_preco' && l.preco != null && originalDe(l.ml_item_id) != null && l.preco >= originalDe(l.ml_item_id)!;
  const abaixoDoPiso = (l: LinhaEditavel) => acao !== 'sair' && l.preco != null && l.preco < PRECO_MIN_PROMOCAO;
  // Oferta fixa do ML (SMART_LIGHTNING, PRICE_MATCHING): preço travado e enviado, sem preço não adere.
  const ofertaFixa = ehOfertaFixa(tipo);
  const semPrecoOfertaFixa = (l: LinhaEditavel) => ofertaFixa && acao === 'aderir' && l.preco == null;
  const marcadas = linhas.filter((l) => l.marcado);
  const risco = precisaConfirmarRisco(acao, linhas);
  const temRisco = risco.vermelho + risco.indisponivel > 0;
  const semFaixa = (l: LinhaEditavel) => tipo === 'LIGHTNING' && (l.min == null || l.max == null);
  const precoInvalido = (l: LinhaEditavel) => abaixoDoPiso(l) || semPrecoOfertaFixa(l) || podeEditarPreco && (l.preco == null || l.preco <= 0 || semFaixa(l) || acimaDoOriginal(l) || (l.min != null && l.max != null && (l.preco < l.min || l.preco > l.max)));
  const podeEnviar = marcadas.length > 0 && !marcadas.some(precoInvalido) && (!temRisco || confirmadoRisco);

  const selecionaveis = linhas.filter((l) => !l.motivoBloqueio);
  const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((l) => l.marcado);
  function marcarTodos(marcado: boolean) {
    setLinhas((prev) => prev.map((l) => (l.motivoBloqueio ? l : { ...l, marcado })));
  }
  function alternarMarcado(id: string) {
    setLinhas((prev) => prev.map((l) => (l.ml_item_id === id ? { ...l, marcado: !l.marcado } : l)));
  }
  function editarPreco(id: string, texto: string) {
    const novas = linhas.map((l) => (l.ml_item_id === id ? aplicarPreco(l, texto, itens) : l));
    setLinhas(novas);
    // Recalcula sozinho quando o operador para de digitar; a resposta só vale para a linha ainda nesse preço.
    clearTimeout(digitando.current.get(id));
    digitando.current.set(id, setTimeout(() => void calcularExato(novas.filter((l) => l.ml_item_id === id)), ESPERA_DIGITACAO_MS));
  }
  function usarAteQuanto(id: string) {
    const novos = linhas.map((l) => (l.ml_item_id === id && l.ateQuanto != null ? aplicarPreco(l, formatarInput(l.ateQuanto), itens) : l));
    setLinhas(novos);
    void calcularExato(novos.filter((l) => l.ml_item_id === id));
  }
  function usarAteQuantoTodos() {
    const novos = linhas.map((l) => (l.ateQuanto != null ? aplicarPreco(l, formatarInput(l.ateQuanto), itens) : l));
    setLinhas(novos);
    void calcularExato(novos.filter((l) => l.ateQuanto != null));
  }

  // Mesmo desconto % ou preço para todas as variações marcadas (pedido do Diego, 03/11).
  const [modo, setModo] = useState<ModoAlvo>('preco');
  const [valorTexto, setValorTexto] = useState('');
  const simularM = useSimularPrecos();
  const valor = parsePreco(valorTexto);
  function aplicarATodos() {
    if (valor == null) return;
    let semOriginal = 0;
    // Todas as linhas (menos bloqueadas): quem veio desmarcado (não verde) também recebe o preço; marcação intacta.
    const novos = linhas.map((l) => {
      if (l.motivoBloqueio) return l;
      const it = itens.find((i) => i.ml_item_id === l.ml_item_id);
      const p = it ? precoAlvo(it, modo, valor) : null;
      if (p == null) { semOriginal++; return l; }
      return aplicarPreco(l, formatarInput(p), itens);
    });
    if (semOriginal) toast.info(`${semOriginal} anúncio(s) sem preço original ficaram com o preço anterior.`);
    setLinhas(novos);
    void calcularExato(novos.filter((l) => !l.motivoBloqueio));
  }
  /** Recebe/lucro/margem no servidor, preço exato (lotes de MAX_SIMULAR, em sequência). */
  async function calcularExato(alvo: LinhaEditavel[]) {
    const g = geracao.current;
    const pedidos = alvo.filter((l) => l.preco != null && l.preco > 0 && !exatoVale(l)).map((l) => ({ ml_item_id: l.ml_item_id, preco: l.preco! }));
    for (let i = 0; i < pedidos.length; i += MAX_SIMULAR) {
      const lote = pedidos.slice(i, i + MAX_SIMULAR);
      let res;
      try {
        res = await simularM.mutateAsync({ promocao_id: promocaoId, itens: lote });
      } catch (e) {
        if (g === geracao.current) {
          toast.error(e instanceof Error ? e.message : 'Não foi possível calcular o lucro agora.');
          const falhou = new Set(lote.map((p) => p.ml_item_id));
          setLinhas((prev) => prev.map((l) => (falhou.has(l.ml_item_id) ? { ...l, avisoCalculo: 'Não foi possível calcular agora.' } : l)));
        }
        return;
      }
      if (g !== geracao.current || !Array.isArray(res)) return;
      const pedido = new Map(lote.map((p) => [p.ml_item_id, p.preco]));
      const porId = new Map(res.map((r) => [r.ml_item_id, r]));
      // Resposta (inclusive "ignorado") só vale para a linha que ainda está no preço pedido.
      setLinhas((prev) => prev.map((l) => {
        const r = porId.get(l.ml_item_id);
        const pedidoPreco = pedido.get(l.ml_item_id);
        if (!r || l.preco == null || pedidoPreco == null || centavos(pedidoPreco) !== centavos(l.preco)) return l;
        if (r.status === 'ignorado') return { ...l, exato: null, avisoCalculo: r.motivo };
        const it = itens.find((x) => x.ml_item_id === l.ml_item_id);
        const s = it ? resumoLucro(it, r) : null;
        return { ...l, semaforo: r.pior_semaforo, exato: s ? { preco: r.preco, ...s, semaforo: r.pior_semaforo } : null, avisoCalculo: s ? undefined : 'Conta indisponível para este anúncio.' };
      }));
    }
  }
  const editaveis = linhas.filter((l) => !l.motivoBloqueio);
  const faltaCalcular = podeEditarPreco && editaveis.some((l) => l.preco != null && l.preco > 0 && !exatoVale(l));

  async function executar() {
    const pedido = marcadas.map((l) => ({
      ml_item_id: l.ml_item_id,
      preco: podeEditarPreco || (ofertaFixa && acao === 'aderir') ? l.preco : null,
      confirmado_risco: confirmadoRisco && (l.semaforo === 'vermelho' || l.semaforo === 'indisponivel'),
    }));
    try {
      await criar.mutateAsync({ acao, promocao_id: promocaoId, origem_id: origemId ?? null, itens: pedido, ...(sugestao ? { sugestao } : {}) });
      toast.success(`Operação iniciada: ${pedido.length} anúncios`);
      if (aoConcluir) { aoConcluir(); return; }
      onSucesso?.();
      onClose();
      navigate('/promocoes?aba=operacoes');
    } catch (e) {
      const erro = e as ErroOperacao;
      if (erro.itens?.length) {
        const porItem = new Map(erro.itens.map((it) => [it.ml_item_id, it]));
        setLinhas((prev) => prev.map((l) => {
          const r = porItem.get(l.ml_item_id);
          if (!r) return l;
          const semaforo = r.semaforo === 'verde' || r.semaforo === 'amarelo' || r.semaforo === 'vermelho' || r.semaforo === 'indisponivel' ? r.semaforo : l.semaforo;
          return { ...l, motivoErro: r.motivo, semaforo };
        }));
      } else {
        toast.error(erro.message ?? 'Não foi possível criar a operação.');
      }
    }
  }

  const titulo = acao === 'aderir' ? `Aderir à ${promocaoNome}`
    : acao === 'alterar_preco' ? `${origemId ? 'Reverter preço' : 'Alterar preço'} em ${promocaoNome}`
    : `Sair de ${promocaoNome}`;

  return (
    <Sheet open={aberto} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{passo && `Campanha ${passo.atual} de ${passo.total} · `}{marcadas.length} de {linhas.length} selecionados para enviar.</SheetDescription>
        </SheetHeader>
        {podeEditarPreco && (
          <div className="flex flex-col gap-2 border-b px-4 pb-3">
            <p className="text-xs font-medium text-muted-foreground">Mesmo preço para {editaveis.length === 1 ? 'o anúncio' : `todos os ${editaveis.length} anúncios`}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={modo} onValueChange={(v) => setModo(v as ModoAlvo)}>
                <TabsList aria-label="Aplicar desconto ou preço aos marcados">
                  <TabsTrigger value="preco">Preço R$</TabsTrigger>
                  <TabsTrigger value="desconto">Desconto %</TabsTrigger>
                </TabsList>
              </Tabs>
              <Input
                value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} inputMode="decimal"
                placeholder={modo === 'desconto' ? 'Ex.: 15' : 'Ex.: 59,90'}
                aria-label={modo === 'desconto' ? 'Desconto em % para todos' : 'Preço em reais para todos'}
                className="w-28 tabular-nums"
              />
              <Button type="button" size="sm" onClick={aplicarATodos} disabled={valor == null || descontoInvalido(modo, valor) || editaveis.length === 0 || simularM.isPending}>
                Aplicar a todos
              </Button>
              {faltaCalcular && (
                <Button type="button" variant="ghost" size="sm" onClick={() => void calcularExato(editaveis)} disabled={simularM.isPending}>
                  {simularM.isPending ? 'Calculando…' : 'Recalcular lucro'}
                </Button>
              )}
            </div>
            {descontoInvalido(modo, valor) && <p className="text-xs text-danger">{AVISO_DESCONTO}</p>}
            {linhas.some((l) => l.ateQuanto != null) && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={usarAteQuantoTodos}>
                  Usar o menor preço viável em todos
                </Button>
                <span className="text-xs text-muted-foreground">
                  Menor preço da faixa do ML em que você ainda recebe o seu líquido mínimo cadastrado.
                </span>
              </div>
            )}
          </div>
        )}
        {selecionaveis.length > 1 && (
          <div className="flex items-center gap-3 border-b px-4 py-2 text-sm">
            <Checkbox id="selecionar-todos" aria-label="Selecionar todos" checked={todosMarcados} onCheckedChange={(v) => marcarTodos(!!v)} />
            <label htmlFor="selecionar-todos">Selecionar todos</label>
          </div>
        )}
        <ul className="flex flex-1 flex-col divide-y divide-border overflow-y-auto px-4">
          {linhas.map((l) => {
            const ui = SEMAFORO_UI[l.semaforo];
            return (
              <li key={l.ml_item_id} className="flex flex-col gap-2 py-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-label={`Selecionar ${l.mlb ?? l.ml_item_id}`}
                    checked={l.marcado}
                    disabled={!!l.motivoBloqueio}
                    onCheckedChange={() => alternarMarcado(l.ml_item_id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{formatarNomeProduto(l.titulo) || l.ml_item_id}</p>
                    <p className="text-xs text-muted-foreground">{l.rotulo ?? l.ml_item_id}</p>
                    {acao === 'aderir' && originalDe(l.ml_item_id) != null && (
                      <p className="text-xs tabular-nums text-muted-foreground">Preço atual <span className="font-medium text-foreground">{fmtBRL(originalDe(l.ml_item_id)!)}</span></p>
                    )}
                    {l.motivoBloqueio && <p className="text-xs text-muted-foreground">{l.motivoBloqueio}</p>}
                    {l.motivoErro && <p className="text-xs text-danger">{l.motivoErro}</p>}
                  </div>
                  <StatusPill tone={ui.tone} title={ui.label} className="shrink-0">
                    <ui.Icon className="size-3.5" aria-hidden />{ui.label}
                  </StatusPill>
                </div>
                {podeEditarPreco ? (
                  <div className="ml-7 flex flex-col gap-1.5">
                    <Input
                      value={l.precoTexto}
                      onChange={(e) => editarPreco(l.ml_item_id, e.target.value)}
                      inputMode="decimal"
                      aria-label={`Preço de ${l.mlb ?? l.ml_item_id}`}
                      className={cn('w-24', precoInvalido(l) && 'border-danger')}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {l.min != null && l.max != null && (
                        <span className="text-xs text-muted-foreground">{fmtBRLSemSimbolo(l.min)} a {fmtBRLSemSimbolo(l.max)}</span>
                      )}
                      {l.ateQuanto != null && (
                        <Button type="button" variant="outline" size="xs" onClick={() => usarAteQuanto(l.ml_item_id)}
                          title="Menor preço da faixa do ML em que você ainda recebe o seu líquido mínimo cadastrado">
                          Menor preço viável: {fmtBRL(l.ateQuanto)}
                        </Button>
                      )}
                    </div>
                    {exatoVale(l) ? detalhe(l) : l.avisoCalculo ? (
                      <p className="text-xs text-danger">{l.avisoCalculo}</p>
                    ) : l.preco != null && l.preco > 0 ? (
                      <p className="text-xs text-muted-foreground">Calculando o que você recebe…</p>
                    ) : null}
                    {semFaixa(l) && <span className="text-xs text-danger">O ML não informou a faixa de preço deste anúncio</span>}
                    {acimaDoOriginal(l) && <span className="text-xs text-danger">Precisa ser menor que o preço original ({fmtBRL(originalDe(l.ml_item_id)!)})</span>}
                    <span className={cn('text-xs', abaixoDoPiso(l) ? 'text-danger' : 'text-muted-foreground')}>Mínimo R$ 19,00 (frete grátis)</span>
                    {tipo === 'LIGHTNING' && l.estoqueMin != null && <span className="text-xs text-muted-foreground">Reserva {l.estoqueMin} un.</span>}
                  </div>
                ) : (
                  <div className="ml-7 flex flex-col gap-1">
                    <p className="text-sm tabular-nums">{l.preco != null ? fmtBRL(l.preco) : '—'}</p>
                    {acao === 'aderir' && <span className={cn('text-xs', abaixoDoPiso(l) || semPrecoOfertaFixa(l) ? 'text-danger' : 'text-muted-foreground')}>Mínimo R$ 19,00 (frete grátis)</span>}
                    {tipo === 'SMART_LIGHTNING' && l.estoqueMin != null && <span className="text-xs text-muted-foreground">Reserva {l.estoqueMin} un.</span>}
                    {tipo === 'PRICE_MATCHING' && acao === 'aderir' && <span className="text-xs text-muted-foreground">Entra no ar assim que você confirmar.</span>}
                    {acao === 'aderir' && exatoVale(l) && detalhe(l)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <SheetFooter>
          {temRisco && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
              <p className="font-medium text-danger">{textoRisco(risco.vermelho, risco.indisponivel)}</p>
              <label htmlFor="risco-confirmado" className="mt-2 flex items-center gap-2">
                <Checkbox id="risco-confirmado" checked={confirmadoRisco} onCheckedChange={(v) => setConfirmadoRisco(!!v)} />
                {acao === 'aderir' ? 'Aderir mesmo assim' : 'Sair mesmo assim'}
              </label>
            </div>
          )}
          {podeExecutar ? (
            <Button onClick={executar} disabled={!podeEnviar || criar.isPending}>Executar</Button>
          ) : (
            <p className="text-sm text-muted-foreground">Só administradores executam operações em massa.</p>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
