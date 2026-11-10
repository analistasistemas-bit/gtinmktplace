// ADR-0201 (Task 10): passo "Gerar". Mostra as imagens que ainda importam no anúncio (as do roteiro aprovado + toda
// cena produzida e não exibida, de qualquer família) e, com roteiro aprovado da família vigente, o pedido novo:
// cores e missões, confirmação "N imagens · R$ X" com o preço do mês (recortes grátis fora do total).
// Cobrança = exibição: a confirmação só sai depois que o <img> carregou e passou em `imagemValida` (no cartão); cada
// imagem mostra o preço congelado no pedido dela, que é o que a RPC cobra. Polling de 5 s enquanto houver linha
// aberta, verificação pendente, carga falha ou confirmação pendente; para ao sair do passo/fechar o diálogo.
// Aprovar (Task 12): compõe o arquivo final no navegador com URLs frescas e os textos do roteiro aprovado, sobe pela URL
// assinada do `preparar_upload` e aprova; tudo com o `ml_item_id` desta linha.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { fmtBRL } from '@/lib/formato';
import {
  aprovarFinal, confirmarExibicao, enviarFinal, gerarImagens, listarImagens, mensagemErro, prepararUploadFinal, reportarInvalida,
  type Ficha, type ImagemGaleria, type RespostaListar,
} from '@/lib/galeria/api';
import { comporImagemFinal } from '@/lib/galeria/compor';
import { lupaPendente, missoesDisponiveis, missoesSugeridas } from '../../../supabase/functions/_shared/galeria/regras';
import { CartaoImagem } from './cartao-imagem';

const POLLING_MS = 5000;
const ERRO_ARQUIVO: Record<string, string> = {
  formato: 'não é JPEG', dimensoes: 'fora de 1200×1540', peso: 'acima de 1 MB', branca: 'imagem branca',
};
const ABERTOS = new Set(['pendente', 'submetendo', 'gerando']);

interface Alvo { cores: string[]; missoes: number[] }
interface Aviso { texto: string; detalhe?: string; acao?: 'tentar' | 'recarregar' | 'roteiro'; bloqueia: boolean }

/** Detalhe da recusa do galeria-gerar (cor/MLB, campos, (cor, missão) bloqueadas). */
function detalheRecusa(c: Record<string, unknown>): string | undefined {
  if (Array.isArray(c.bloqueadas)) return (c.bloqueadas as Array<{ cor: string; missao: number }>).map((b) => `${b.cor} · missão ${b.missao}`).join(', ');
  if (Array.isArray(c.campos)) return (c.campos as string[]).join(', ');
  if (Array.isArray(c.cores)) return (c.cores as string[]).join(', ');
  if (Array.isArray(c.missoes)) return `Missões ${(c.missoes as number[]).join(', ')}`;
  if (typeof c.cor === 'string') return [c.cor, c.item_id].filter(Boolean).join(' · ');
  return undefined;
}

export function PassoGerar({ mlItemId, ficha, aoRecarregar, aoVoltarRoteiro }: {
  mlItemId: string; ficha: Ficha; aoRecarregar: () => void; aoVoltarRoteiro: () => void;
}) {
  const [lista, setLista] = useState<RespostaListar | null>(null);
  const roteiro = lista?.roteiro ?? null;
  const moda = roteiro?.moda === true;
  const info = useMemo(() => new Map(missoesDisponiveis(moda, ['frente', 'costas', 'lateral']).map((m) => [m.missao as number, m])), [moda]);
  const ativas = useMemo(() => (roteiro?.missoes_ativas ?? []).filter((m) => info.has(m)), [roteiro?.missoes_ativas, info]);

  const [cores, setCores] = useState<string[]>(ficha.cores);
  // Pré-marcadas por `missoesSugeridas` quando o roteiro aprovado chega (null = ainda não chegou).
  const [missoes, setMissoes] = useState<number[] | null>(null);
  const [unit, setUnit] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState<Alvo | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  // Erro do `listar` fica separado do aviso do gerar: nunca reabre um Confirmar bloqueado.
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rodada, setRodada] = useState(0);
  // Um pedido_id por confirmação: a repetição (ml_indisponivel) reusa; nova confirmação gera outro.
  const pedido = useRef<string | null>(null);
  // URL assinada muda a cada listar: a primeira fica (senão o <img> recarrega a cada poll); carga falha a descarta.
  const urls = useRef(new Map<string, string>());
  // Passaram em `imagemValida`: o poll repete a confirmação até o servidor dizer `exibida` (RPC idempotente).
  const validadas = useRef(new Set<string>());
  const emVoo = useRef(new Set<string>());
  const reportadas = useRef(new Set<string>());

  useEffect(() => {
    if (!roteiro || missoes !== null) return;
    const sugeridas = new Set<number>(missoesSugeridas(ficha.cores.length));
    setMissoes(ativas.filter((m) => sugeridas.has(m)));
  }, [roteiro, missoes, ativas, ficha.cores.length]);

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

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rodar = async () => {
      const r = await listarImagens(mlItemId);
      if (!vivo) return;
      if (!r.ok) {
        setErroLista(mensagemErro(r.erro));
        // Falha passageira (rede/5xx) reagenda; recusa (4xx) para.
        if (r.erro === 'rede' || r.status === 0 || r.status >= 500) timer = setTimeout(rodar, POLLING_MS);
        return;
      }
      setErroLista(null);
      const imagens = r.dados.imagens.map((i) => {
        if (i.url && !urls.current.has(i.id)) urls.current.set(i.id, i.url);
        return { ...i, url: urls.current.get(i.id) ?? i.url };
      });
      setLista({ ...r.dados, imagens });
      setUnit(r.dados.unit_cents);
      const pendentes = imagens.filter((i) => !i.exibida && validadas.current.has(i.id));
      pendentes.forEach((i) => confirmar(i.id));
      const precisa = imagens.some((i) => ABERTOS.has(i.status) || (i.status === 'gerada' && i.origem === 'gerador' && i.alertas === null))
        || pendentes.length > 0;
      if (precisa) timer = setTimeout(rodar, POLLING_MS);
    };
    void rodar();
    return () => { vivo = false; clearTimeout(timer); };
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
    // URLs assinadas vencem (10 min): o listar dá a cena, a referência e os textos vigentes no momento do clique.
    const l = await listarImagens(mlItemId);
    if (!l.ok) return mensagemErro(l.erro);
    const i = l.dados.imagens.find((x) => x.id === img.id);
    if (!i || !l.dados.roteiro) return mensagemErro('nao_aprovavel');
    let arquivo: Blob;
    try {
      arquivo = await comporImagemFinal({
        cenaUrl: i.origem === 'gerador' ? i.url : null, refUrl: i.ref_url, missao: i.missao,
        textos: l.dados.roteiro.textos?.[i.missao] ?? {}, corProduto: null, moda: l.dados.roteiro.moda,
      });
    } catch (e) { return (e as Error).message; }
    const p = await prepararUploadFinal(mlItemId, i.id);
    if (!p.ok) return mensagemErro(p.erro);
    const falhaEnvio = await enviarFinal(p.dados.path, p.dados.token, arquivo);
    if (falhaEnvio) return `Falha ao enviar o arquivo final: ${falhaEnvio}`;
    const a = await aprovarFinal(mlItemId, i.id);
    if (!a.ok) {
      return a.erro === 'arquivo_invalido'
        ? `Arquivo final recusado: ${((a.corpo.erros as string[] | undefined) ?? []).map((x) => ERRO_ARQUIVO[x] ?? x).join(', ')}`
        : mensagemErro(a.erro);
    }
    setRodada((n) => n + 1);
    return null;
  }, [mlItemId]);

  /** Nova seleção = nova confirmação: limpa recusa e pedido. */
  const abrir = (alvo: Alvo | null) => { pedido.current = null; setAviso(null); setConfirmando(alvo); };
  const alternar = <T,>(xs: T[], v: T, marcar: boolean) => (marcar ? [...xs, v] : xs.filter((x) => x !== v));

  async function enviar() {
    if (!confirmando || unit === null || !roteiro) return;
    pedido.current ??= crypto.randomUUID();
    setOcupado(true);
    const r = await gerarImagens(mlItemId, {
      pedidoId: pedido.current, roteiroVersao: roteiro.versao, cores: confirmando.cores, missoes: confirmando.missoes, unitCentsExibido: unit,
    });
    setOcupado(false);
    if (r.ok) {
      pedido.current = null; setConfirmando(null); setAviso(null);
      toast.success('Geração pedida');
      setRodada((n) => n + 1);
      return;
    }
    if (r.erro === 'ml_indisponivel' || r.erro === 'rede') { setAviso({ texto: mensagemErro('ml_indisponivel'), acao: 'tentar', bloqueia: false }); return; }
    pedido.current = null;
    const novo = r.corpo.unit_cents;
    if (r.erro === 'preco_mudou' && Number.isInteger(novo)) {
      setUnit(novo as number);
      setAviso({ texto: `O preço mudou para ${fmtBRL((novo as number) / 100)} por imagem. Confira o novo total e confirme de novo.`, bloqueia: false });
      return;
    }
    setAviso({
      texto: mensagemErro(r.erro), detalhe: detalheRecusa(r.corpo), bloqueia: true,
      acao: r.erro === 'familia_nao_vigente' ? 'recarregar' : r.erro === 'conteudo.ciencia_nao_conferido' ? 'roteiro' : undefined,
    });
  }

  const conta = (alvo: Alvo) => {
    const comGerador = alvo.missoes.filter((m) => info.get(m)?.usaGerador).length;
    return { geradas: alvo.cores.length * comGerador, recortes: alvo.cores.length * (alvo.missoes.length - comGerador) };
  };
  const resumo = confirmando && unit !== null ? conta(confirmando) : null;
  // Pedido novo só pelo roteiro aprovado da família vigente (o galeria-gerar recusa os demais).
  const podePedir = !!roteiro && roteiro.familia_id === ficha.familia_id;
  const sel = missoes ?? [];

  return (
    <div className="space-y-4">
      {lista && !roteiro && (
        <p className="text-sm text-muted-foreground">Aprove o roteiro para gerar imagens novas.</p>
      )}
      {roteiro && !podePedir && (
        <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          O roteiro aprovado é de uma família anterior deste anúncio. Crie e aprove o roteiro da família atual para gerar imagens novas.
        </p>
      )}
      {podePedir && (
        <div className="space-y-2 rounded border p-3 text-sm">
          <p className="font-medium">Cores</p>
          <div className="flex flex-wrap gap-3">
            {ficha.cores.map((c) => (
              <span key={c} className="flex items-center gap-2">
                <Checkbox aria-label={`Cor ${c}`} checked={cores.includes(c)}
                  onCheckedChange={(v) => { setCores(alternar(cores, c, v === true)); abrir(null); }} />{c}
              </span>
            ))}
          </div>
          <p className="font-medium">Missões</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {ativas.map((n) => (
              <span key={n} className="flex items-center gap-2">
                <Checkbox aria-label={`Missão ${n}`} checked={sel.includes(n)}
                  onCheckedChange={(v) => { setMissoes(alternar(sel, n, v === true).sort((a, b) => a - b)); abrir(null); }} />
                {n}. {info.get(n)?.nome}{info.get(n)?.usaGerador === false && <span className="text-xs text-muted-foreground">(recorte grátis)</span>}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {unit === null ? 'Carregando o preço…' : `Pedido novo: ${fmtBRL(unit / 100)} por imagem gerada (preço do mês), cobrada quando aparece na tela.`}
          </p>
          <Button disabled={cores.length === 0 || sel.length === 0 || unit === null}
            onClick={() => abrir({ cores: ficha.cores.filter((c) => cores.includes(c)), missoes: sel })}>
            Gerar imagens
          </Button>
        </div>
      )}

      {podePedir && confirmando && resumo && (
        <div className="space-y-2 rounded border p-3 text-sm">
          <p className="font-medium">
            {resumo.geradas} {resumo.geradas === 1 ? 'imagem' : 'imagens'} · {fmtBRL((resumo.geradas * unit!) / 100)}
          </p>
          {resumo.recortes > 0 && (
            <p className="text-xs text-muted-foreground">+ {resumo.recortes} {resumo.recortes === 1 ? 'recorte grátis' : 'recortes grátis'}</p>
          )}
          <div className="flex gap-2">
            <Button disabled={ocupado || !!aviso?.bloqueia} onClick={() => void enviar()}>
              {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar
            </Button>
            <Button variant="outline" disabled={ocupado} onClick={() => abrir(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {aviso && (
        <div role="alert" className="space-y-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm">
          <p>{aviso.texto}</p>
          {aviso.detalhe && <p className="text-xs">{aviso.detalhe}</p>}
          {aviso.acao === 'tentar' && <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void enviar()}>Tentar de novo</Button>}
          {aviso.acao === 'recarregar' && <Button size="sm" variant="outline" onClick={aoRecarregar}>Recarregar</Button>}
          {aviso.acao === 'roteiro' && <Button size="sm" variant="outline" onClick={aoVoltarRoteiro}>Voltar ao roteiro</Button>}
        </div>
      )}

      {erroLista && <p role="alert" className="text-sm text-red-600">{erroLista}</p>}

      {lista && lista.imagens.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lista.imagens.map((i: ImagemGaleria) => (
            <CartaoImagem key={i.id} imagem={i} onExibida={exibida} onInvalida={invalida} onFalhaCarga={falhaCarga}
              onAprovar={roteiro && i.roteiro_id === roteiro.id ? aprovar : undefined}
              bloqueioAprovar={lupaPendente(i.missao, moda) ? 'lupa em ajuste' : undefined}
              onGerarDeNovo={podePedir ? (x) => abrir({ cores: [x.cor], missoes: [x.missao] }) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
