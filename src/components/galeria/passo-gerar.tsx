// ADR-0201 (Task 10): passo "Gerar" — depois do roteiro aprovado. O operador escolhe cores e missões, confirma
// "N imagens · R$ X" com o preço vigente do servidor (recortes grátis fora do total) e acompanha as imagens.
// Cobrança = exibição: a confirmação só sai depois que o <img> carregou e passou em `imagemValida` (no cartão).
// Polling de 5 s só enquanto houver linha aberta ou verificação pendente; para ao sair do passo/fechar o diálogo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { fmtBRL } from '@/lib/formato';
import {
  confirmarExibicao, gerarImagens, listarImagens, mensagemErro, reportarInvalida,
  type Ficha, type ImagemGaleria, type RespostaListar, type RespostaRoteiro,
} from '@/lib/galeria/api';
import { missoesDisponiveis, missoesSugeridas } from '../../../supabase/functions/_shared/galeria/regras';
import { CartaoImagem } from './cartao-imagem';

const POLLING_MS = 5000;
const ABERTOS = new Set(['pendente', 'submetendo', 'gerando']);
const precisaPolling = (imgs: ImagemGaleria[]) =>
  imgs.some((i) => ABERTOS.has(i.status) || (i.status === 'gerada' && i.origem === 'gerador' && i.alertas === null));

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

export function PassoGerar({ mlItemId, ficha, resp, aoRecarregar, aoVoltarRoteiro }: {
  mlItemId: string; ficha: Ficha;
  /** Roteiro aprovado (o diálogo só mostra este passo com ele). */
  resp: RespostaRoteiro;
  aoRecarregar: () => void; aoVoltarRoteiro: () => void;
}) {
  const { roteiro } = resp;
  const info = useMemo(() => new Map(missoesDisponiveis(roteiro.moda, ['frente', 'costas', 'lateral']).map((m) => [m.missao as number, m])), [roteiro.moda]);
  const ativas = useMemo(() => roteiro.conteudo.missoes.filter((m) => m.ativa && info.has(m.missao)).map((m) => m.missao).sort((a, b) => a - b),
    [roteiro.conteudo.missoes, info]);

  const [cores, setCores] = useState<string[]>(ficha.cores);
  const [missoes, setMissoes] = useState<number[]>(() => {
    const sugeridas = new Set<number>(missoesSugeridas(ficha.cores.length));
    return ativas.filter((m) => sugeridas.has(m));
  });
  const [lista, setLista] = useState<RespostaListar | null>(null);
  const [unit, setUnit] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState<Alvo | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rodada, setRodada] = useState(0);
  // Um pedido_id por confirmação: a repetição (ml_indisponivel) reusa; nova confirmação gera outro.
  const pedido = useRef<string | null>(null);
  // URL assinada muda a cada listar: a primeira fica, senão o <img> recarrega e o onLoad dispara de novo.
  const urls = useRef(new Map<string, string>());
  // Imagens já confirmadas ou reportadas nesta abertura: no máximo uma chamada por imagem.
  const tratadas = useRef(new Set<string>());

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rodar = async () => {
      const r = await listarImagens(mlItemId, roteiro.versao);
      if (!vivo) return;
      if (!r.ok) { setAviso({ texto: mensagemErro(r.erro), bloqueia: false }); return; }
      const imagens = r.dados.imagens.map((i) => {
        if (i.url && !urls.current.has(i.id)) urls.current.set(i.id, i.url);
        return { ...i, url: urls.current.get(i.id) ?? i.url };
      });
      setLista({ ...r.dados, imagens });
      setUnit(r.dados.unit_cents);
      if (precisaPolling(imagens)) timer = setTimeout(rodar, POLLING_MS);
    };
    void rodar();
    return () => { vivo = false; clearTimeout(timer); };
  }, [mlItemId, roteiro.versao, rodada]);

  const exibida = useCallback((id: string) => {
    if (tratadas.current.has(id)) return;
    tratadas.current.add(id);
    void confirmarExibicao(mlItemId, [id]).then((r) => { if (!r.ok) tratadas.current.delete(id); });
  }, [mlItemId]);

  const invalida = useCallback((id: string) => {
    if (tratadas.current.has(id)) return;
    tratadas.current.add(id);
    void reportarInvalida(mlItemId, id).then(() => setRodada((n) => n + 1));
  }, [mlItemId]);

  /** Nova seleção = nova confirmação: limpa recusa e pedido. */
  const abrir = (alvo: Alvo | null) => { pedido.current = null; setAviso(null); setConfirmando(alvo); };
  const alternar = (lista: string[] | number[], v: string | number, marcar: boolean) =>
    marcar ? [...lista, v] : (lista as Array<string | number>).filter((x) => x !== v);

  async function enviar() {
    if (!confirmando || unit === null) return;
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

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded border p-3 text-sm">
        <p className="font-medium">Cores</p>
        <div className="flex flex-wrap gap-3">
          {ficha.cores.map((c) => (
            <span key={c} className="flex items-center gap-2">
              <Checkbox aria-label={`Cor ${c}`} checked={cores.includes(c)}
                onCheckedChange={(v) => { setCores(alternar(cores, c, v === true) as string[]); abrir(null); }} />{c}
            </span>
          ))}
        </div>
        <p className="font-medium">Missões</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {ativas.map((n) => (
            <span key={n} className="flex items-center gap-2">
              <Checkbox aria-label={`Missão ${n}`} checked={missoes.includes(n)}
                onCheckedChange={(v) => { setMissoes((alternar(missoes, n, v === true) as number[]).sort((a, b) => a - b)); abrir(null); }} />
              {n}. {info.get(n)?.nome}{info.get(n)?.usaGerador === false && <span className="text-xs text-muted-foreground">(recorte grátis)</span>}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {unit === null ? 'Carregando o preço…' : `${fmtBRL(unit / 100)} por imagem gerada, cobrada quando aparece na tela.`}
        </p>
        <Button disabled={cores.length === 0 || missoes.length === 0 || unit === null}
          onClick={() => abrir({ cores: ficha.cores.filter((c) => cores.includes(c)), missoes })}>
          Gerar imagens
        </Button>
      </div>

      {confirmando && resumo && (
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

      {lista && lista.imagens.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lista.imagens.map((i) => (
            <CartaoImagem key={i.id} imagem={i} onExibida={exibida} onInvalida={invalida}
              onGerarDeNovo={(x) => abrir({ cores: [x.cor], missoes: [x.missao] })} />
          ))}
        </div>
      )}
    </div>
  );
}
