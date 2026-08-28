import { Navigate, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { cn } from '@/lib/utils';
import { SECOES, type Secao } from '@/components/configuracoes/secoes';
import { usePermissoesConfig } from '@/components/configuracoes/permissoes';

/**
 * O guard de OAuth do ML roda ANTES de qualquer hook da tela — por isso mora neste
 * componente, que só usa `useSearchParams`, e não dentro do layout, que monta ~15 hooks.
 *
 * A edge function devolve o callback em /configuracoes (URL fixa), mas quem confirma a
 * conexão é /canais. `ml_claim` entrou com o ADR-0091. A query PRECISA ser preservada:
 * `Canais.tsx` lê esses parâmetros para chamar `confirmarConexaoML` — um `<Navigate
 * to="/canais">` sem a search mata a confirmação sem erro visível.
 */
export default function Configuracoes() {
  const [searchParams] = useSearchParams();

  if (searchParams.get('ml_conectado') || searchParams.get('ml_erro') || searchParams.get('ml_claim')) {
    return <Navigate to={{ pathname: '/canais', search: searchParams.toString() }} replace />;
  }

  return <ConfiguracoesLayout />;
}

function ConfiguracoesLayout() {
  const { pathname } = useLocation();
  const { podeVerMembros, profileLoading } = usePermissoesConfig();
  const { data: aliquotas } = useAliquotas();

  // O marcador de "alíquotas não confirmadas" vive na sub-nav, então a query mora aqui, no
  // pai: dentro da seção Fiscal ela só rodaria quando a seção estivesse montada. Mesma
  // queryKey da seção, então o react-query dedupe — uma requisição só.
  const fiscalPendente = aliquotas != null && !aliquotas.confirmada;

  const visiveis = SECOES.filter((s) => !s.somenteMembros || podeVerMembros);
  const slug = pathname.replace(/^\/configuracoes\/?/, '').split('/')[0];
  const secao = visiveis.find((s) => s.slug === slug);

  if (profileLoading) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="Configurações" />
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );
  }

  // Slug ausente, desconhecido, ou de seção invisível ao perfil. `visiveis` nunca é vazio —
  // `geral` não tem gate — então o destino existe sempre e não há como haver loop.
  if (!secao) return <Navigate to={`/configuracoes/${visiveis[0].slug}`} replace />;

  const Conteudo = secao.Componente;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Configurações" subtitle="Preferências desta organização." />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <SubNav secoes={visiveis} atual={secao} fiscalPendente={fiscalPendente} />
        <div className={cn('min-w-0 flex-1', !secao.larguraCheia && 'max-w-3xl')}>
          <div className="mb-4">
            <h2 className="text-h3">{secao.titulo}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{secao.descricao}</p>
          </div>
          <Conteudo />
        </div>
      </div>
    </div>
  );
}

function SubNav({ secoes, atual, fiscalPendente }: {
  secoes: Secao[]; atual: Secao; fiscalPendente: boolean;
}) {
  return (
    <>
      {/* Em tela estreita a coluna vira um select: cabe em 360px e não rouba altura,
          independente de quantas seções existirem. */}
      <div className="lg:hidden">
        <label htmlFor="secao-config" className="mb-1 block text-xs font-medium text-muted-foreground">
          Seção
        </label>
        <SelectSecao secoes={secoes} atual={atual} fiscalPendente={fiscalPendente} />
      </div>

      <nav aria-label="Seções de configurações" className="hidden w-56 shrink-0 lg:block">
        <ul className="sticky top-6 space-y-0.5">
          {secoes.map((s) => {
            const Icone = s.icone;
            const pendente = fiscalPendente && s.slug === 'fiscal';
            return (
              <li key={s.slug}>
                <NavLink
                  to={`/configuracoes/${s.slug}`}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <Icone className="size-4 shrink-0" />
                  <span className="truncate">{s.titulo}</span>
                  {pendente && (
                    <span
                      className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
                      aria-label="Alíquotas não confirmadas"
                    />
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

function SelectSecao({ secoes, atual, fiscalPendente }: {
  secoes: Secao[]; atual: Secao; fiscalPendente: boolean;
}) {
  const location = useLocation();
  return (
    <Select
      value={atual.slug}
      onValueChange={(v) => {
        // HashRouter: navegação por hash mantém o comportamento de voltar do navegador.
        window.location.hash = `#/configuracoes/${v}${location.search}`;
      }}
    >
      <SelectTrigger id="secao-config" className="h-9 w-full text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {secoes.map((s) => (
          <SelectItem key={s.slug} value={s.slug}>
            {s.titulo}{fiscalPendente && s.slug === 'fiscal' ? ' •' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
