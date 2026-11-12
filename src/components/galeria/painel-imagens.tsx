// ADR-0203: painel da tela única. Mostra as 7 imagens possíveis de cada cor (ou de uma faixa por cor, em "Todas as
// cores"), gera uma a uma ou todas, aprova e refaz. Toda geração passa pelo diálogo "N imagens · R$ X,XX".
// Cobrança = exibição: a confirmação só sai depois que o <img> carregou e passou em `imagemValida` (no cartão); o poll de
// 5 s repete a confirmação até o servidor dizer `exibida`. Polling enquanto houver imagem aberta, conferência do texto
// pendente ou confirmação pendente; para ao desmontar.
// "Todas as cores": pedidos de até 5 cores, um depois do outro; a primeira recusa para a fila (os anteriores seguem).
// Aprovar: recorta o arquivo final no navegador com URL fresca (sem compor texto), sobe pela URL assinada e aprova.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { BorderTrail } from '@/components/ui/border-trail';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtBRL } from '@/lib/formato';
import {
  aprovarFinal, confirmarExibicao, enviarFinal, gerarImagens, listarImagens, mensagemErro, prepararUploadFinal, reportarInvalida,
  type ImagemGaleria, type RespostaListar,
} from '@/lib/galeria/api';
import { montarArquivoFinal } from '@/lib/galeria/final';
import { emAndamento } from '@/lib/galeria/exibicao';
import { CartaoImagem } from './cartao-imagem';

const POLLING_MS = 5000;
const POR_PEDIDO = 5;
const ERRO_ARQUIVO: Record<string, string> = {
  formato: 'formato de arquivo inválido', dimensoes: 'tamanho fora do padrão', peso: 'arquivo pesado demais', branca: 'imagem em branco',
};
const FALHA_FINAL = 'Não foi possível preparar a imagem final. Tente aprovar de novo.';
/** Recusas em que outra tentativa com pedido novo pode dar certo (as demais travam o Confirmar). */
const REFAZ_PEDIDO = new Set(['plano_ia_falhou', 'plano_invalido']);

interface Pedido { cores: string[]; missoes: number[] }
interface Aviso { texto: string; detalhe?: string; tentar?: boolean; bloqueia: boolean }

const quantidade = (ps: Pedido[]) => ps.reduce((n, p) => n + p.cores.length * p.missoes.length, 0);
const imagens = (n: number) => `${n} ${n === 1 ? 'imagem' : 'imagens'}`;

/** Pedidos para "Gerar todas": cores com as mesmas imagens faltando ficam juntas, em lotes de até 5. */
function montarPedidos(cores: string[], disponiveis: number[], falta: (cor: string, posicao: number) => boolean): Pedido[] {
  const grupos = new Map<string, Pedido>();
  for (const cor of cores) {
    const missoes = disponiveis.filter((p) => falta(cor, p));
    if (missoes.length === 0) continue;
    const g = grupos.get(missoes.join()) ?? { cores: [], missoes };
    g.cores.push(cor);
    grupos.set(missoes.join(), g);
  }
  return [...grupos.values()].flatMap((g) =>
    Array.from({ length: Math.ceil(g.cores.length / POR_PEDIDO) }, (_, k) => ({ cores: g.cores.slice(k * POR_PEDIDO, (k + 1) * POR_PEDIDO), missoes: g.missoes })));
}

/** Imagem que já vale para a posição: aberta, aprovada ou pronta do plano vigente. */
const viva = (i: ImagemGaleria, planoId: string | null) => emAndamento(i) || i.status === 'aprovada' || (i.status === 'gerada' && i.roteiro_id === planoId);

/** Geração mais recente da cor e posição (as do plano vigente primeiro); descartada e desatualizada não contam. */
function maisRecente(gs: ImagemGaleria[], planoId: string | null): ImagemGaleria | undefined {
  return gs.filter((i) => i.status !== 'descartada' && i.status !== 'desatualizada')
    .sort((a, b) => Number(b.roteiro_id === planoId) - Number(a.roteiro_id === planoId) || b.geracao - a.geracao)[0];
}

function motivoArquivo(e: unknown): string {
  const m = e instanceof Error ? e.message : '';
  if (m === 'corte') return 'Esta imagem não cabe no formato do anúncio. Gere de novo.';
  console.warn('[galeria] arquivo final falhou:', m);
  return FALHA_FINAL;
}

export function PainelImagens({ mlItemId, cor, aoLista, aoFalha }: {
  mlItemId: string;
  /** Cor mostrada; null = todas as cores do anúncio. */
  cor: string | null;
  /** Cada `listar`: a página lê título, cores e aprovadas. */
  aoLista?: (l: RespostaListar) => void;
  /** `listar` recusado (4xx) ou com falha: a página decide se o anúncio nem existe. */
  aoFalha?: (erro: string) => void;
}) {
  const [lista, setLista] = useState<RespostaListar | null>(null);
  const [unit, setUnit] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState<{ pedidos: Pedido[] } | null>(null);
  const [troca, setTroca] = useState<number | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rodada, setRodada] = useState(0);
  // "Aprovar todas": confirmação aberta, andamento da fila e falhas (a fila nunca para numa falha).
  const [confirmaTodas, setConfirmaTodas] = useState<{ itens: ImagemGaleria[]; comAviso: number } | null>(null);
  const [progresso, setProgresso] = useState<{ n: number; total: number } | null>(null);
  const [falhas, setFalhas] = useState<Array<{ cor: string; nome: string; motivo: string }>>([]);
  const montado = useRef(true);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  // Um pedido_id por pedido da fila: a repetição (ml_indisponivel) reusa; nova confirmação gera outros.
  const ids = useRef<string[]>([]);
  const trocaConfirmada = useRef(false);
  // URL assinada muda a cada listar: a primeira fica (senão o <img> recarrega a cada poll); carga falha a descarta.
  const urls = useRef(new Map<string, string>());
  // Passaram em `imagemValida`: o poll repete a confirmação até o servidor dizer `exibida` (RPC idempotente).
  const validadas = useRef(new Set<string>());
  const emVoo = useRef(new Set<string>());
  const reportadas = useRef(new Set<string>());

  // Nova rodada do `listar` daqui a 5 s (nunca em laço imediato: com CORS ausente toda carga falha).
  const proxima = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(proxima.current), []);
  const agendarRodada = useCallback(() => {
    if (proxima.current !== undefined) return;
    proxima.current = setTimeout(() => { proxima.current = undefined; setRodada((n) => n + 1); }, POLLING_MS);
  }, []);

  const confirmar = useCallback((id: string) => {
    if (emVoo.current.has(id)) return;
    emVoo.current.add(id);
    // Rede/5xx: o listar seguinte repete (a imagem segue `validada` e não `exibida`).
    void confirmarExibicao(mlItemId, [id]).then((r) => { if (!r.ok) agendarRodada(); }).finally(() => emVoo.current.delete(id));
  }, [mlItemId, agendarRodada]);

  /** Guarda a primeira URL de cada imagem e publica a lista. */
  const receber = useCallback((dados: RespostaListar): ImagemGaleria[] => {
    const todas = dados.imagens.map((i) => {
      if (i.url && !urls.current.has(i.id)) urls.current.set(i.id, i.url);
      return { ...i, url: urls.current.get(i.id) ?? i.url };
    });
    setLista({ ...dados, imagens: todas });
    aoLista?.({ ...dados, imagens: todas });
    setUnit(dados.unit_cents);
    return todas;
  }, [aoLista]);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rodar = async () => {
      const r = await listarImagens(mlItemId);
      if (!vivo) return;
      if (!r.ok) {
        setErroLista(mensagemErro(r.erro));
        aoFalha?.(r.erro);
        // Falha passageira (rede/5xx) reagenda; recusa (4xx) para.
        if (r.erro === 'rede' || r.status === 0 || r.status >= 500) timer = setTimeout(rodar, POLLING_MS);
        return;
      }
      setErroLista(null);
      const todas = receber(r.dados);
      const pendentes = todas.filter((i) => !i.exibida && validadas.current.has(i.id));
      pendentes.forEach((i) => confirmar(i.id));
      if (todas.some(emAndamento) || pendentes.length > 0) timer = setTimeout(rodar, POLLING_MS);
    };
    void rodar();
    return () => { vivo = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `aoLista`/`aoFalha` só informam a página; não reiniciam o polling
  }, [mlItemId, rodada, confirmar]);

  const exibida = useCallback((id: string) => { validadas.current.add(id); confirmar(id); }, [confirmar]);

  const invalida = useCallback((id: string) => {
    if (reportadas.current.has(id)) return;
    reportadas.current.add(id);
    void reportarInvalida(mlItemId, id).then(() => setRodada((n) => n + 1));
  }, [mlItemId]);

  const falhaCarga = useCallback((id: string) => {
    // O próximo listar traz URL assinada nova; cada nova falha agenda outra tentativa.
    urls.current.delete(id);
    agendarRodada();
  }, [agendarRodada]);

  const aprovar = useCallback(async (img: ImagemGaleria): Promise<string | null> => {
    // URLs assinadas vencem (10 min): o listar dá a URL vigente no momento do clique.
    const l = await listarImagens(mlItemId);
    if (!l.ok) return mensagemErro(l.erro);
    const i = l.dados.imagens.find((x) => x.id === img.id);
    if (!i || !i.url || !l.dados.plano_id || i.roteiro_id !== l.dados.plano_id) return mensagemErro('nao_aprovavel');
    let arquivo: Blob;
    try { arquivo = await montarArquivoFinal(i.url, i.missao === 1); } catch (e) { return motivoArquivo(e); }
    const p = await prepararUploadFinal(mlItemId, i.id);
    if (!p.ok) return mensagemErro(p.erro);
    const falhaEnvio = await enviarFinal(p.dados.path, p.dados.token, arquivo);
    if (falhaEnvio) { console.warn('[galeria] envio do arquivo final:', falhaEnvio); return FALHA_FINAL; }
    let a = await aprovarFinal(mlItemId, i.id);
    // Só aprova imagem já cobrada: confirma a exibição (idempotente) e repete UMA vez o aprovar: o arquivo final já
    // está no `final_upload_path`, sem recortar nem subir de novo.
    // A confirmação COBRA: só para imagem que o <img> desta sessão mostrou e validou (`imagemValida`).
    if (!a.ok && a.erro === 'exibicao_pendente') {
      if (!validadas.current.has(i.id)) return 'A imagem ainda não terminou de carregar. Aguarde ela aparecer e aprove de novo.';
      const c = await confirmarExibicao(mlItemId, [i.id]);
      if (c.ok) a = await aprovarFinal(mlItemId, i.id);
    }
    if (!a.ok) {
      return a.erro === 'arquivo_invalido'
        ? `A imagem final foi recusada (${((a.corpo.erros as string[] | undefined) ?? []).map((x) => ERRO_ARQUIVO[x] ?? 'arquivo inválido').join(', ')}). Gere de novo.`
        : mensagemErro(a.erro);
    }
    setRodada((n) => n + 1);
    return null;
  }, [mlItemId]);

  const nomeDe = (p: number) => lista?.posicoes.find((x) => x.posicao === p)?.nome ?? `Imagem ${p}`;

  /** Aprova em sequência, uma por vez, pela mesma `aprovar` do cartão; falha numa imagem não para a fila. */
  async function aprovarTodas() {
    if (!confirmaTodas) return;
    const { itens } = confirmaTodas;
    setConfirmaTodas(null); setFalhas([]); setProgresso({ n: 1, total: itens.length });
    const erros: Array<{ cor: string; nome: string; motivo: string }> = [];
    let feitas = 0;
    for (const [k, img] of itens.entries()) {
      if (!montado.current) return;
      setProgresso({ n: k + 1, total: itens.length });
      let motivo: string | null;
      try { motivo = await aprovar(img); } catch { motivo = FALHA_FINAL; }
      if (motivo === null) feitas += 1; else erros.push({ cor: img.cor, nome: nomeDe(img.missao), motivo });
    }
    if (!montado.current) return;
    setProgresso(null); setFalhas(erros);
    if (feitas > 0) toast.success(`${feitas} ${feitas === 1 ? 'imagem aprovada' : 'imagens aprovadas'}`);
    setRodada((n) => n + 1);
  }

  function fechar() {
    ids.current = []; trocaConfirmada.current = false;
    setConfirmando(null); setTroca(null); setAviso(null);
  }
  function abrir(pedidos: Pedido[]) {
    if (pedidos.length === 0) return;
    ids.current = []; trocaConfirmada.current = false;
    setBanner(null); setAviso(null); setTroca(null); setConfirmando({ pedidos });
  }

  /** Detalhe da recusa do galeria-gerar (cores, imagens ou (cor, imagem) bloqueadas). */
  function detalheRecusa(c: Record<string, unknown>): string | undefined {
    if (Array.isArray(c.bloqueadas)) return (c.bloqueadas as Array<{ cor: string; missao: number }>).map((b) => `${nomeDe(b.missao)} · ${b.cor}`).join(', ');
    if (Array.isArray(c.cores)) return (c.cores as string[]).join(', ');
    if (Array.isArray(c.missoes)) return (c.missoes as number[]).map(nomeDe).join(', ');
    if (typeof c.cor === 'string') return c.cor;
    return undefined;
  }

  /** Envia os pedidos que faltam, um depois do outro; a primeira recusa para a fila. */
  async function enviar() {
    if (!confirmando || unit === null) return;
    let restantes = confirmando.pedidos;
    setOcupado(true); setAviso(null);
    while (restantes.length > 0) {
      const [ped] = restantes;
      ids.current[0] ??= crypto.randomUUID();
      const r = await gerarImagens(mlItemId, {
        pedidoId: ids.current[0], cores: ped.cores, missoes: ped.missoes, unitCentsExibido: unit, confirmarTroca: trocaConfirmada.current,
      });
      if (r.ok) { restantes = restantes.slice(1); ids.current.shift(); continue; }

      setOcupado(false);
      setConfirmando({ pedidos: restantes });
      const enviados = confirmando.pedidos.length - restantes.length;
      const antes = enviados > 0 ? `${enviados === 1 ? 'O 1º pedido já foi enviado e segue gerando' : `Os ${enviados} primeiros pedidos já foram enviados e seguem gerando`}. ` : '';
      if (r.erro === 'ml_indisponivel' || r.erro === 'rede') {
        setAviso({ texto: antes + mensagemErro('ml_indisponivel'), tentar: true, bloqueia: false });
        return;
      }
      if (r.erro === 'plano_desatualizado') { setTroca(Number(r.corpo.imagens) || 0); return; }
      ids.current = [];
      const novo = r.corpo.unit_cents;
      if (r.erro === 'preco_mudou' && Number.isInteger(novo)) {
        setUnit(novo as number);
        setAviso({ texto: `${antes}O preço mudou para ${fmtBRL((novo as number) / 100)} por imagem. Confira o novo total e confirme de novo.`, bloqueia: false });
        return;
      }
      if (r.erro === 'posicao_indisponivel') { await relistarSemIndisponiveis(restantes, r.corpo.missoes, antes); return; }
      setAviso({ texto: antes + mensagemErro(r.erro), detalhe: detalheRecusa(r.corpo), bloqueia: !REFAZ_PEDIDO.has(r.erro) });
      return;
    }
    setOcupado(false);
    toast.success('Geração pedida');
    fechar();
    setRodada((n) => n + 1);
  }

  /** `posicao_indisponivel`: relê a lista, tira as imagens sem dados do pedido e reabre o diálogo com o novo total. */
  async function relistarSemIndisponiveis(restantes: Pedido[], recusadas: unknown, antes: string) {
    const l = await listarImagens(mlItemId);
    const fora = new Set<number>(Array.isArray(recusadas) ? (recusadas as number[]) : []);
    if (l.ok) {
      receber(l.dados);
      l.dados.posicoes.filter((p) => p.indisponivel).forEach((p) => fora.add(p.posicao));
    }
    const novos = restantes.map((p) => ({ ...p, missoes: p.missoes.filter((m) => !fora.has(m)) })).filter((p) => p.missoes.length > 0);
    if (novos.length === 0) {
      fechar();
      setBanner('Faltam dados do produto para estas imagens. Elas não podem ser geradas.');
      return;
    }
    setConfirmando({ pedidos: novos });
    setAviso({ texto: `${antes}Faltam dados do produto para algumas imagens e elas ficaram de fora. Confira o novo total e confirme.`, bloqueia: false });
  }

  if (!lista) {
    return (
      <div className="space-y-3">
        {erroLista && <p role="alert" className="text-sm text-destructive">{erroLista}</p>}
        {!erroLista && (
          <div aria-busy="true" aria-label="Carregando as imagens" className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
            {Array.from({ length: 7 }, (_, k) => <Skeleton key={k} className="aspect-[1200/1540] h-auto w-full rounded-xl" />)}
          </div>
        )}
      </div>
    );
  }

  const preco = unit ?? lista.unit_cents;
  const precoTxt = fmtBRL(preco / 100);
  const coresEscopo = cor === null ? lista.cores : lista.cores.filter((c) => c === cor);
  const disponiveis = lista.posicoes.filter((p) => !p.indisponivel).map((p) => p.posicao);
  const faltaGerar = (c: string, p: number) => !lista.imagens.some((i) => i.cor === c && i.missao === p && viva(i, lista.plano_id));
  const todas = montarPedidos(coresEscopo, disponiveis, faltaGerar);
  const nTodas = quantidade(todas);
  const nConfirmar = confirmando ? quantidade(confirmando.pedidos) : 0;
  const gerarUma = (c: string, p: number) => abrir([{ cores: [c], missoes: [p] }]);

  // Aprovar em massa: só a imagem à mostra, pronta, sem nenhum aviso, já exibida (cobrada) e da versão vigente.
  const prontas = coresEscopo.flatMap((c) => lista.posicoes.flatMap((p) => {
    const atual = maisRecente(lista.imagens.filter((i) => i.cor === c && i.missao === p.posicao), lista.plano_id);
    return atual && atual.status === 'gerada' && !!lista.plano_id && atual.roteiro_id === lista.plano_id ? [atual] : [];
  }));
  const aprovaveis = prontas.filter((i) => i.alertas !== null && i.alertas.length === 0 && i.exibida);
  const nComAviso = prontas.filter((i) => (i.alertas?.length ?? 0) > 0).length;
  const trabalhando = ocupado || progresso !== null;

  return (
    <div className="space-y-4">
      <section aria-label="Gerar todas" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-3 text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5">
        <p className="min-w-0 flex-1 text-muted-foreground">
          {imagens(1)} custa <span className="font-medium tabular-nums text-foreground">{precoTxt}</span>. Cerca de 30 s por imagem. Cobrada quando aparece na tela.
        </p>
        <div className="flex flex-col gap-2 max-sm:w-full sm:flex-row">
          {(aprovaveis.length > 0 || progresso) && (
            // `grid`: o botão continua esticando no celular (flex-col) dentro do contorno.
            <BorderTrail active={!!progresso} radius="var(--radius)" className="grid">
              <Button variant="outline" className="h-10 px-4" disabled={trabalhando}
                onClick={() => setConfirmaTodas({ itens: aprovaveis, comAviso: nComAviso })}>
                {progresso ? <><Loader2 aria-hidden className="motion-safe:animate-spin" />{`Aprovando ${progresso.n} de ${progresso.total}…`}</> : `Aprovar todas (${aprovaveis.length})`}
              </Button>
            </BorderTrail>
          )}
          <Button className="h-10 px-4" disabled={trabalhando || nTodas === 0} onClick={() => abrir(todas)}>
            {nTodas === 0 ? 'Gerar todas' : `Gerar todas (${imagens(nTodas)} · ${fmtBRL((nTodas * preco) / 100)})`}
          </Button>
        </div>
      </section>

      {banner && <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm ring-1 ring-warning/25">{banner}</p>}
      {falhas.length > 0 && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg bg-destructive/10 p-3 text-sm ring-1 ring-destructive/25">
          <ul className="min-w-0 space-y-1">
            {falhas.map((f, k) => <li key={k}>Não foi possível aprovar: {f.nome} ({f.cor}): {f.motivo}</li>)}
          </ul>
          <Button variant="outline" size="sm" onClick={() => setFalhas([])}>Fechar</Button>
        </div>
      )}
      {erroLista && <p role="alert" className="text-sm text-destructive">{erroLista}</p>}

      {coresEscopo.map((c) => (
        <section key={c} aria-label={cor === null ? `Imagens da cor ${c}` : 'Imagens'} className="space-y-2">
          {cor === null && <h2 className="text-sm font-semibold">{c}</h2>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
            {lista.posicoes.map((p) => {
              const gs = lista.imagens.filter((i) => i.cor === c && i.missao === p.posicao);
              const atual = maisRecente(gs, lista.plano_id);
              return (
                <CartaoImagem key={p.posicao} nome={p.nome} cor={c} preco={precoTxt} imagem={atual} indisponivel={p.indisponivel}
                  antiga={!!atual && atual.roteiro_id !== lista.plano_id}
                  temAprovada={!!atual && gs.some((i) => i.status === 'aprovada' && i.id !== atual.id)}
                  travado={trabalhando} onGerar={p.indisponivel && !atual ? undefined : () => gerarUma(c, p.posicao)}
                  onAprovar={aprovar} onExibida={exibida} onInvalida={invalida} onFalhaCarga={falhaCarga} />
              );
            })}
          </div>
        </section>
      ))}

      <Dialog open={!!confirmaTodas} onOpenChange={(o) => { if (!o) setConfirmaTodas(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar {confirmaTodas ? imagens(confirmaTodas.itens.length) : ''}?</DialogTitle>
            <DialogDescription>Cada imagem é preparada e enviada uma por vez.</DialogDescription>
          </DialogHeader>
          {!!confirmaTodas?.comAviso && (
            <p className="text-sm">{confirmaTodas.comAviso} com aviso de texto ficam para você conferir uma a uma.</p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-10 px-4" onClick={() => setConfirmaTodas(null)}>Cancelar</Button>
            <Button className="h-10 px-4" onClick={() => void aprovarTodas()}>Aprovar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmando && troca === null} onOpenChange={(o) => { if (!o && !ocupado) fechar(); }}>
        <DialogContent processando={ocupado} rotuloProcessando="Enviando o pedido">
          <DialogHeader>
            <DialogTitle>Gerar imagens</DialogTitle>
            <DialogDescription>Confira a quantidade e o valor antes de gerar.</DialogDescription>
          </DialogHeader>
          <p className="text-base font-semibold tabular-nums">{imagens(nConfirmar)} · {fmtBRL((nConfirmar * preco) / 100)}</p>
          {(confirmando?.pedidos.length ?? 0) > 1 && (
            <p className="text-xs text-muted-foreground">Enviado em {confirmando!.pedidos.length} pedidos, um depois do outro.</p>
          )}
          <p className="text-xs text-muted-foreground">Cerca de 30 s por imagem. Cobrada quando aparece na tela.</p>
          {aviso && (
            <div role="alert" className="space-y-1 rounded-lg bg-destructive/10 p-2.5 text-xs ring-1 ring-destructive/25">
              <p>{aviso.texto}</p>
              {aviso.detalhe && <p>{aviso.detalhe}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-10 px-4" disabled={ocupado} onClick={fechar}>Cancelar</Button>
            <Button className="h-10 px-4" disabled={ocupado || !!aviso?.bloqueia} onClick={() => void enviar()}>
              {ocupado && <Loader2 aria-hidden className="mr-2 size-4 motion-safe:animate-spin" />}{aviso?.tentar ? 'Tentar de novo' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={troca !== null} onOpenChange={(o) => { if (!o && !ocupado) fechar(); }}>
        <DialogContent processando={ocupado} rotuloProcessando="Enviando o pedido">
          <DialogHeader>
            <DialogTitle>Dados do anúncio mudaram</DialogTitle>
            <DialogDescription>
              {`${troca ?? 0} ${troca === 1 ? 'imagem pronta deixa' : 'imagens prontas deixam'} de valer. Gerar mesmo assim?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-10 px-4" disabled={ocupado} onClick={fechar}>Cancelar</Button>
            <Button className="h-10 px-4" disabled={ocupado} onClick={() => { trocaConfirmada.current = true; setTroca(null); void enviar(); }}>
              {ocupado && <Loader2 aria-hidden className="mr-2 size-4 motion-safe:animate-spin" />}Gerar mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
