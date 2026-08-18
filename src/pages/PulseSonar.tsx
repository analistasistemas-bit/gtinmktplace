// Sonar (ADR-0120): garimpo on-demand de um nicho do Mercado Livre, par do Radar (Pulse.tsx),
// que vigia o que já vendemos. O Sonar varre ANTES de cadastrar o produto.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BadgeCheck, Check, ChevronDown, ChevronRight, Circle, CircleDollarSign, Clock, Eye, Globe,
  Loader2, Package, Receipt, Search, ShoppingCart, Store, Trash2, TrendingUp, Trophy, Truck,
  Users, Zap,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { DialogMargemSonar } from '@/components/pulse/dialog-margem-sonar';
import { VereditoSonar } from '@/components/pulse/veredito-sonar';
import {
  lerBuscasRecentes, limparBuscasRecentes, registrarBusca, tempoRelativo, type BuscaRecente,
} from '@/lib/sonar-buscas-recentes';
import { calcularVeredito } from '@/lib/veredito-sonar';
import {
  fetchPainelSonar, fetchVendasSonar, fichasAtivas, fichasSemVendedor, passosProgresso,
  type PainelSonar, type EtapaProgresso, type RaioXNicho, type RespostaVendasSonar,
} from '@/lib/sonar';
import { fmtBRL, fmtInt, fmtMilhar } from '@/lib/formato';

function SonarProgresso({ passos }: { passos: EtapaProgresso[] }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border p-4">
      {passos.map((p) => (
        <div key={p.label} className="flex items-center gap-2 text-sm">
          {p.status === 'concluida' ? (
            <Check className="h-4 w-4 shrink-0 text-success" />
          ) : p.status === 'ativa' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : (
            <Circle className="h-4 w-4 shrink-0 text-muted-foreground/30" />
          )}
          <span className={p.status === 'pendente' ? 'text-muted-foreground' : ''}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

// Raio-X do nicho: contagens da mesma amostra já paga da Apify (custo extra zero) + o total de
// anúncios que o ML imprime na página de busca. Itens com valor null são omitidos, nunca zerados.
function RaioXBarra({ raioX }: { raioX: RaioXNicho }) {
  const itens = [
    { icone: Receipt, label: 'Ticket médio', valor: raioX.ticket_medio != null ? fmtBRL(raioX.ticket_medio) : null, amostra: true },
    { icone: Store, label: 'Lojas oficiais', valor: String(raioX.lojas_oficiais), amostra: true },
    { icone: Zap, label: 'Full', valor: String(raioX.full), amostra: true },
    { icone: Truck, label: 'Frete grátis', valor: String(raioX.frete_gratis), amostra: true },
    { icone: Globe, label: 'Internacionais', valor: String(raioX.internacionais), amostra: true },
    {
      icone: BadgeCheck,
      label: 'Total de anúncios',
      valor: raioX.total_anuncios != null ? fmtMilhar(raioX.total_anuncios, 1) : null,
      amostra: false,
    },
  ].filter((i) => i.valor !== null);
  if (itens.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t pt-2.5">
      {itens.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs">
          <i.icone className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
          <span className="text-muted-foreground">{i.label}:</span>
          <span className="font-semibold tabular-nums">{i.valor}</span>
        </span>
      ))}
      <span className="text-[11px] text-muted-foreground/70">
        · contagens na amostra; total é do nicho inteiro
      </span>
    </div>
  );
}

// Bloco de vendas estimadas (ADR-0122): carrega em paralelo ao painel oficial e degrada sozinho —
// Apify fora do ar ou sem token nunca derruba o resto do Sonar.
function SonarVendas({ resp, carregando, erro }: {
  resp: RespostaVendasSonar | undefined; carregando: boolean; erro: boolean;
}) {
  if (carregando) {
    return (
      <Card className="mb-4 p-4">
        <div className="mb-2 text-sm font-medium">Vendas do nicho</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      </Card>
    );
  }
  if (erro) {
    return (
      <Card className="mb-4 p-4">
        <div className="mb-1 text-sm font-medium">Vendas do nicho</div>
        <p className="text-sm text-muted-foreground">
          Consulta de vendas falhou ou demorou demais — o resto do painel não é afetado. Busque de
          novo para tentar outra vez.
        </p>
      </Card>
    );
  }
  if (!resp) return null;
  if (!resp.configurado) {
    return (
      <Card className="mb-4 p-4">
        <div className="mb-1 text-sm font-medium">Vendas do nicho</div>
        <p className="text-sm text-muted-foreground">
          Configure o token da Apify (variável <code className="font-mono text-xs">APIFY_TOKEN</code>)
          para ver vendas acumuladas, mercado endereçável e produto destaque do nicho.
        </p>
      </Card>
    );
  }

  const destaque = resp.produto_destaque;
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Vendas do nicho</span>
        <Badge variant="outline">estimativa · via Apify</Badge>
        <span className="text-xs text-muted-foreground">
          amostra dos {resp.itens_analisados} anúncios mais relevantes — "+N vendidos" acumulado,
          piso do nicho e não venda mensal
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          size="compact"
          label="Vendas acumuladas"
          // "unidades" explícito: sem a palavra o número passa por valor em reais (dúvida real do
          // Diego em 18/08). Quem é valor é o card ao lado.
          value={`≈ ${fmtMilhar(resp.vendas_totais, 1)} unidades`}
          hint={`${resp.itens_com_vendas} de ${resp.itens_analisados} anúncios com o dado`}
          icon={ShoppingCart}
          tom="info"
        />
        <KpiCard
          size="compact"
          label="Mercado endereçável"
          value={`≈ R$ ${fmtMilhar(resp.valor_mercado, 1)}`}
          hint="Σ preço × vendidos acumulados"
          icon={CircleDollarSign}
          tom="info"
        />
        {destaque && (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            {destaque.imagem && (
              <img src={destaque.imagem} alt="" className="h-12 w-12 shrink-0 rounded bg-white object-contain" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Trophy className="h-3.5 w-3.5 text-warning" /> Produto destaque
              </div>
              {destaque.link ? (
                <a
                  href={destaque.link}
                  target="_blank"
                  rel="noreferrer"
                  title={destaque.titulo}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {destaque.titulo}
                </a>
              ) : (
                <div className="truncate text-sm font-medium" title={destaque.titulo}>{destaque.titulo}</div>
              )}
              <div className="text-xs text-muted-foreground">
                ≈ {fmtMilhar(destaque.vendidos ?? 0, 1)} vendidos
                {destaque.preco != null && ` · ${fmtBRL(destaque.preco)}`}
              </div>
            </div>
          </div>
        )}
      </div>
      {resp.raio_x && <RaioXBarra raioX={resp.raio_x} />}
      {resp.palavras_chave_titulos.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Palavras-chave dos títulos dos anúncios
          </div>
          <div className="flex flex-wrap gap-1.5">
            {resp.palavras_chave_titulos.slice(0, 15).map((p) => (
              <Badge key={p.termo} variant="secondary">{p.termo} ({p.contagem})</Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function PulseSonar() {
  const [termo, setTermo] = useState('');
  const [termoBuscado, setTermoBuscado] = useState<string | null>(null);
  const [, forcarRender] = useState(0);
  const iniciadoEmRef = useRef(0);
  const [semVendedorAberto, setSemVendedorAberto] = useState(false);
  const [fichaSimulando, setFichaSimulando] = useState<PainelSonar['fichas'][number] | null>(null);
  const [buscasRecentes, setBuscasRecentes] = useState<BuscaRecente[]>(lerBuscasRecentes);
  // Mantém o stepper visível um instante depois da resposta chegar, para mostrar as 4 etapas
  // concluídas antes de trocar pelo resultado (em vez de sumir direto na 3ª, travada).
  const [mostrarProgresso, setMostrarProgresso] = useState(false);

  const { data: painel, isFetching, isError, error } = useQuery({
    queryKey: ['pulse', 'sonar', termoBuscado],
    queryFn: () => fetchPainelSonar(termoBuscado!),
    enabled: !!termoBuscado,
    staleTime: Infinity, // cache real é o Redis (24h) — o front nunca refaz a mesma busca sozinho
  });

  // Vendas estimadas (ADR-0122): paralelo e independente do painel oficial. retry desligado —
  // cada tentativa sem cache dispara um run pago na Apify.
  const { data: vendas, isFetching: vendasCarregando, isError: vendasErro } = useQuery({
    queryKey: ['pulse', 'sonar-vendas', termoBuscado],
    queryFn: () => fetchVendasSonar(termoBuscado!),
    enabled: !!termoBuscado,
    staleTime: Infinity,
    retry: false,
  });

  // A tela de resultado só abre quando o painel oficial E as vendas resolverem (pedido do Diego
  // 18/08: "quando aparecer a tela, já tem que estar todas as informações"). Sem isso o painel
  // estreava com esqueleto no bloco de vendas e o veredito trocava de nível na frente do
  // operador quando a Apify respondia. Vendas com erro também resolve (retry: false) — falha
  // nunca prende o operador no stepper.
  const carregando = isFetching || vendasCarregando;

  // Avanço do stepper temporizado no cliente: cada edge responde numa chamada única.
  useEffect(() => {
    if (carregando) {
      if (iniciadoEmRef.current === 0) iniciadoEmRef.current = Date.now();
      setMostrarProgresso(true);
      forcarRender((n) => n + 1);
      const id = setInterval(() => forcarRender((n) => n + 1), 250);
      return () => clearInterval(id);
    }
    iniciadoEmRef.current = 0;
    const t = setTimeout(() => setMostrarProgresso(false), 400);
    return () => clearTimeout(t);
  }, [carregando]);

  const garimpar = (t: string) => {
    setBuscasRecentes(registrarBusca(t));
    setTermo(t);
    setTermoBuscado(t);
  };

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const t = termo.trim();
    if (t.length < 3) { toast.error('Digite ao menos 3 caracteres para garimpar.'); return; }
    garimpar(t);
  };

  const ativas = painel ? fichasAtivas(painel) : [];
  const vazias = painel ? fichasSemVendedor(painel) : [];
  const elapsedMs = iniciadoEmRef.current ? Date.now() - iniciadoEmRef.current : 0;

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Garimpa um nicho do Mercado Livre antes de você cadastrar o produto — o par do Radar, que
        vigia o que você já vende.
      </p>

      <form onSubmit={buscar} className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Ex.: tecido oxford 10 metros"
            aria-label="Termo de busca no Sonar"
            className="h-9 pl-8"
          />
        </div>
        <Button type="submit" disabled={carregando}>
          <Search className="mr-2 h-4 w-4" />
          Garimpar
        </Button>
      </form>

      {!termoBuscado ? (
        buscasRecentes.length > 0 ? (
          <Card className="max-w-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                Buscas recentes
              </div>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { limparBuscasRecentes(); setBuscasRecentes([]); }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Limpar tudo
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {buscasRecentes.map((b) => (
                <button
                  key={b.termo}
                  type="button"
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => garimpar(b.termo)}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{b.termo}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {tempoRelativo(b.em, new Date())}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        ) : (
          <EmptyState
            icon={Search}
            title="O que o Sonar faz"
            description={
              'Varre um nicho do Mercado Livre antes de você cadastrar o produto: fichas de '
              + 'catálogo, concorrência, preço e demanda do nicho. Limites do dado: só cobre '
              + 'produtos com ficha de catálogo, e a demanda é medida por visitas e ranking — o '
              + 'Mercado Livre não expõe vendas exatas de terceiros.'
            }
          />
        )
      ) : mostrarProgresso ? (
        <SonarProgresso passos={passosProgresso(elapsedMs, !carregando)} />
      ) : isError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Não foi possível garimpar este termo.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro desconhecido.'}
          </p>
        </div>
      ) : painel ? (
        <>
          <VereditoSonar veredito={calcularVeredito(painel, vendas?.configurado ? vendas : null)} />

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <KpiCard size="compact" label="Visitas (30d)" value={fmtMilhar(painel.agregado.visitas_30d_total, 1)} icon={Eye} tom="info" />
            <KpiCard
              size="compact"
              label="Fichas no catálogo"
              // O ML satura `paging.total` em 10.000 — sem o "+" o número vira uma contagem falsa.
              value={painel.total_catalogo >= 10_000
                ? `${fmtMilhar(painel.total_catalogo)}+`
                : fmtMilhar(painel.total_catalogo)}
              hint={`${ativas.length + vazias.length} analisadas`}
              icon={Package}
              tom="info"
            />
            <KpiCard size="compact" label="Ofertas" value={fmtInt(painel.agregado.ofertas_total)} icon={TrendingUp} tom="info" />
            <KpiCard size="compact" label="Vendedores distintos" value={painel.agregado.vendedores_distintos} icon={Users} tom="info" />
            <KpiCard size="compact" label="Frete grátis" value={`${painel.agregado.frete_gratis_pct}%`} icon={Truck} tom="info" />
          </div>

          <SonarVendas resp={vendas} carregando={vendasCarregando} erro={vendasErro} />

          {painel.agregado.visitas_por_dia.length > 0 && (
            <Card className="mb-4 p-4">
              <div className="mb-2 text-sm font-medium">Visitas por dia</div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={painel.agregado.visitas_por_dia} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad-sonar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="data" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={40} tickFormatter={(v) => fmtInt(Number(v))} />
                    <RTooltip formatter={(v) => [fmtInt(Number(v)), 'Visitas']} labelClassName="text-foreground" contentStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={2} fill="url(#grad-sonar)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {ativas.length === 0 ? (
            <EmptyState icon={Package} title="Nenhuma ficha com vendedor ativo para este termo." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Ofertas</TableHead>
                    <TableHead>Faixa de preço</TableHead>
                    <TableHead>Visitas (30d)</TableHead>
                    <TableHead>Vendedores / UF</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ativas.map((f) => {
                    const ufs = [...new Set(f.vendedores.map((v) => v.uf).filter((uf): uf is string => !!uf))];
                    return (
                      <TableRow key={f.product_id}>
                        <TableCell className="max-w-xs truncate" title={f.nome}>{f.nome}</TableCell>
                        <TableCell className="tabular-nums">{f.ofertas}</TableCell>
                        <TableCell className="tabular-nums">
                          {f.preco ? `${fmtBRL(f.preco.min)} – ${fmtBRL(f.preco.max)}` : '—'}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {f.visitas_30d == null
                            ? <span title="Não medido">—</span>
                            : fmtInt(f.visitas_30d)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {f.vendedores.length} {ufs.length > 0 && `(${ufs.join(', ')})`}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => setFichaSimulando(f)}>
                            Simular margem
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {painel.palavras_chave.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-sm font-medium">Palavras-chave do nicho</div>
              <div className="flex flex-wrap gap-1.5">
                {painel.palavras_chave.map((p) => (
                  <Badge key={p.termo} variant="secondary">{p.termo} ({p.contagem})</Badge>
                ))}
              </div>
            </div>
          )}

          {vazias.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setSemVendedorAberto((o) => !o)}
              >
                {semVendedorAberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Fichas de catálogo sem vendedor ativo ({vazias.length})
              </button>
              {semVendedorAberto && (
                <div className="mt-2 rounded-lg border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Essas fichas já existem no catálogo do Mercado Livre, mas ninguém está vendendo
                    agora — pode ser oportunidade: a ficha está pronta e sem concorrência ativa.
                  </p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {vazias.map((f) => <li key={f.product_id}>{f.nome}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      <DialogMargemSonar ficha={fichaSimulando} onFechar={() => setFichaSimulando(null)} />
    </div>
  );
}
