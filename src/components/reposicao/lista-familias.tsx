// Spec §3.3 a §3.4: uma linha por família; expandida mostra o mapa da grade, o "Por quê" e as ações.
import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useQueryClient } from '@tanstack/react-query';
import { invalidarImagem, useImageUrl } from '@/hooks/useImageUrl';
import { montarFotoResolver } from '@/lib/fotos-produto';
import type { VendaItem } from '@/lib/faturamento';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { coresForaDeLinha, familiaForaDeLinha, type FamiliaVisao } from '@/hooks/useReposicao';
import type { PedidoDTO } from '../../../supabase/functions/_shared/reposicao/tipos';
import { normalizarNome } from '../../../supabase/functions/_shared/reposicao/calculo';
import { MapaGrade } from './mapa-grade';
import { CalculoSku, type CtxCalculo } from './popover-celula';
import { fmtDia, pctSinal, PorQue, ROTULO_URGENCIA, TOM_URGENCIA } from './por-que';

export interface AcoesLista {
  adicionar: (f: FamiliaVisao) => void;
  /** Só admin (vale para toda compra do produto); ausente = só leitura. */
  definirMultiplo?: (p: { codigoPai: string; multiplo: number }) => void;
}

/** Rascunho do fornecedor da família: pelo id do cadastro; sem id, pelo nome normalizado (como a edge). */
function rascunhoDaFamilia(f: Pick<FamiliaVisao, 'fornecedor'>, rascunhos: PedidoDTO[]): PedidoDTO | undefined {
  return rascunhos.find((r) => (f.fornecedor.id
    ? r.fornecedor.id === f.fornecedor.id
    : normalizarNome(r.fornecedor.nome) === normalizarNome(f.fornecedor.nome)));
}

/** "Compra em múltiplos de [N]" (ADR-0207 §11): grava ao sair do campo ou no Enter; inválido volta ao valor salvo. */
function Multiplo({ f, onDefinir, pendente }: { f: FamiliaVisao; onDefinir?: AcoesLista['definirMultiplo']; pendente?: boolean }) {
  const id = useId();
  const [v, setV] = useState(String(f.multiplo));
  const [visto, setVisto] = useState(f.multiplo);
  const enviado = useRef<number | null>(null); // Enter e depois blur: um envio só
  if (visto !== f.multiplo) { setVisto(f.multiplo); setV(String(f.multiplo)); }
  if (!onDefinir) return f.multiplo > 1 ? <span className="text-caption">Compra em múltiplos de {fmtInt(f.multiplo)}.</span> : null;
  const salvar = () => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1000) { setV(String(f.multiplo)); return; }
    if (n === f.multiplo || n === enviado.current) return;
    enviado.current = n;
    onDefinir({ codigoPai: f.codigoPai, multiplo: n });
  };
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id}>Compra em múltiplos de</label>
      <Input
        id={id} type="number" inputMode="numeric" min={1} max={1000} value={v} disabled={pendente}
        onChange={(e) => setV(e.target.value)} onBlur={salvar} onKeyDown={(e) => { if (e.key === 'Enter') salvar(); }}
        className="h-11 w-20 tabular-nums md:h-8"
      />
    </div>
  );
}

const COLUNAS = 'md:grid md:grid-cols-[2.5rem_minmax(0,2.4fr)_minmax(0,1fr)_8.5rem_4rem_4.5rem_4.5rem_7.5rem] md:items-center md:gap-3';

function Foto({ codigo }: { codigo: string }) {
  const { data: fotos } = useFotosProduto();
  // ponytail: o resolver só usa `codigo` aqui (sem anúncio/GTIN na tela de reposição).
  const path = useMemo(() => montarFotoResolver(fotos)({ codigo } as VendaItem), [fotos, codigo]);
  const { data: url } = useImageUrl(path);
  const qc = useQueryClient();
  // Autocura: URL assinada guardada que falha (visto no Safari) é descartada e gerada de novo uma vez.
  return <FotoCapaFamilia capaUrl={url ?? null} tamanho="small" renovar={path ? () => invalidarImagem(qc, path) : undefined} />;
}

function Pill({ f }: { f: FamiliaVisao }) {
  const chega = f.urgencia === 'ruptura' && f.chegaEm ? ` · chega ${fmtDia(f.chegaEm)}` : '';
  return <StatusPill tone={TOM_URGENCIA[f.urgencia]}>{ROTULO_URGENCIA[f.urgencia]}{chega}</StatusPill>;
}

/** Valor com rótulo só no celular (no desktop o cabeçalho da coluna rotula). */
/** Célula sem valor: um ponto discreto ("-" leria como negativo), com o que falta dito ao leitor de tela. */
function Vazio({ nome }: { nome: string }) {
  return <span role="img" aria-label={nome} className="text-muted-foreground">·</span>;
}

function Dado({ rotulo, children, className }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('flex flex-col tabular-nums md:block md:text-right', className)}>
      <span className="text-caption md:hidden">{rotulo}</span>
      {children}
    </span>
  );
}

/** A Reposição só obedece "fora de linha"; quem marca e desmarca é o Estoque. */
const AbrirNoEstoque = () => (
  <Link to="/estoque" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline md:min-h-0">Abrir no Estoque</Link>
);

function Detalhe({ f, ctx, acoes, rascunho, mostrarForaDeLinha }: {
  f: FamiliaVisao; ctx: CtxCalculo; acoes: AcoesLista; rascunho: PedidoDTO | undefined; mostrarForaDeLinha: boolean;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const foraCores = coresForaDeLinha(f);
  const itens = f.skus.filter((s) => s.sug.pedir > 0 && !s.tela.naoReporId);
  const semFornecedor = !f.fornecedor.nome.trim();
  const noRascunho = rascunho?.itens.some((i) => i.codigoPai === f.codigoPai);

  const adicionar = (
    <Button className="h-11 sm:h-9" disabled={!itens.length || semFornecedor || ctx.pendente} onClick={() => acoes.adicionar(f)}>
      Adicionar ao pedido
    </Button>
  );
  return (
    <div className="flex flex-col gap-4 border-t border-border bg-muted/20 px-3 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200 motion-safe:ease-out md:pl-[4.25rem]">
      {f.temGrade
        ? <MapaGrade familia={f} ctx={ctx} selecionado={sel} onSelecionar={setSel} coresForaDeLinha={foraCores} ocultarForaDeLinha={!mostrarForaDeLinha} />
        : <div className="max-w-sm"><CalculoSku s={f.skus[0]} familia={f} ctx={ctx} /></div>}
      <PorQue familia={f} />
      {(f.naoReporFamiliaId || foraCores.size > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">{f.naoReporFamiliaId ? 'Produto fora de linha.' : 'Há cores fora de linha neste produto.'}</span>
          <AbrirNoEstoque />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {adicionar}
        {semFornecedor && <span className="text-caption">Produto sem fornecedor cadastrado.</span>}
        {noRascunho && <span className="text-caption">Já está no rascunho de {f.fornecedor.nome}.</span>}
      </div>
      <Multiplo f={f} onDefinir={acoes.definirMultiplo} pendente={ctx.pendente} />
    </div>
  );
}

export function ListaFamilias({ familias, expandidos, onAlternar, ctx, acoes, rascunhos, mostrarForaDeLinha = false }: {
  familias: FamiliaVisao[]; expandidos: ReadonlySet<string>; onAlternar: (codigoPai: string) => void;
  ctx: CtxCalculo; acoes: AcoesLista; rascunhos: PedidoDTO[];
  /** Filtro "Mostrar fora de linha": o que está fora de linha aparece esmaecido, com selo. */
  mostrarForaDeLinha?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/5">
      <div className={cn('hidden border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground', COLUNAS)} aria-hidden>
        <span /><span>Produto</span><span>Fornecedor</span><span>Urgência</span>
        <span className="text-right">Tendência</span><span className="text-right">Dias</span><span className="text-right">A caminho</span><span className="text-right">Sugestão</span>
      </div>
      <ul className="divide-y divide-border">
        {familias.map((f) => {
          const aberto = expandidos.has(f.codigoPai);
          const Seta = aberto ? ChevronDown : ChevronRight;
          const fora = familiaForaDeLinha(f);
          return (
            <li key={f.codigoPai} id={`familia-${f.codigoPai}`} className={cn(fora && 'opacity-60')}>
              <button
                type="button"
                aria-expanded={aberto}
                onClick={() => onAlternar(f.codigoPai)}
                className={cn(
                  'grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 text-left text-sm outline-none transition-colors',
                  'hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', COLUNAS,
                )}
              >
                <Foto codigo={f.skus[0].tela.codigo} />
                <span className="flex min-w-0 items-center gap-1.5">
                  <Seta className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate font-medium">{f.nome}</span>
                </span>
                <span className="col-start-3 row-start-1 md:col-auto md:row-auto">
                  {fora ? <StatusPill tone="neutral">Fora de linha</StatusPill> : <Pill f={f} />}
                </span>
                <span className="col-span-3 truncate text-muted-foreground md:col-auto md:row-start-1 md:col-start-3">{f.fornecedor.nome || 'Sem fornecedor'}</span>
                <span className="col-span-3 grid grid-cols-4 gap-2 md:contents">
                  <Dado rotulo="Tendência">{f.tendencia ? pctSinal(f.tendencia.fator - 1) : <Vazio nome="sem tendência" />}</Dado>
                  <Dado rotulo="Dias de estoque">{f.diasDeEstoque === null ? <Vazio nome="sem previsão" /> : `${fmtInt(f.diasDeEstoque)} d`}</Dado>
                  <Dado rotulo="A caminho">{f.aCaminho ? `${fmtInt(f.aCaminho)} un.` : <Vazio nome="nada a caminho" />}</Dado>
                  <Dado rotulo="Sugestão" className="font-medium">
                    {f.pedir ? <>{fmtInt(f.pedir)} un. <span className="block text-caption md:inline">{fmtBRL(f.valor)}</span></> : <Vazio nome="nada a pedir" />}
                  </Dado>
                </span>
              </button>
              {aberto && <Detalhe f={f} ctx={ctx} acoes={acoes} rascunho={rascunhoDaFamilia(f, rascunhos)} mostrarForaDeLinha={mostrarForaDeLinha} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
