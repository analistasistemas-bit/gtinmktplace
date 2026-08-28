import { lazy, type ComponentType } from 'react';
import { Boxes, Bell, Building2, Cpu, Settings2, Users } from 'lucide-react';
import { SecaoGeral } from './secao-geral';
import { SecaoPrecos } from './secao-precos';
import { SecaoFiscal } from './secao-fiscal';
import { SecaoIA } from './secao-ia';
import { SecaoNotificacoes } from './secao-notificacoes';

// A página de Usuários vira uma seção. O lazy vive aqui, não em App.tsx, senão sobra uma
// declaração não usada lá e o ESLint reprova.
const Usuarios = lazy(() => import('@/pages/Usuarios'));

function SecaoMembros() {
  return <Usuarios semCabecalho />;
}

export interface Secao {
  slug: string;
  titulo: string;
  descricao: string;
  icone: ComponentType<{ className?: string }>;
  /** Só `Membros` tem gate de visibilidade — leitura das demais é liberada na org. */
  somenteMembros?: true;
  /** Tabela (não formulário): usa a largura cheia do painel. */
  larguraCheia?: true;
  Componente: ComponentType;
}

export const SECOES: Secao[] = [
  {
    slug: 'geral',
    titulo: 'Geral',
    descricao: 'Canais conectados e o que aparece no Dashboard.',
    icone: Settings2,
    Componente: SecaoGeral,
  },
  {
    slug: 'precos',
    titulo: 'Preços',
    descricao: 'Descontos e ancoragem do preço sugerido.',
    icone: Boxes,
    Componente: SecaoPrecos,
  },
  {
    slug: 'fiscal',
    titulo: 'Fiscal',
    descricao: 'Imposto por origem e cadastro da empresa.',
    icone: Building2,
    Componente: SecaoFiscal,
  },
  {
    slug: 'notificacoes',
    titulo: 'Notificações',
    descricao: 'Alertas no Telegram.',
    icone: Bell,
    Componente: SecaoNotificacoes,
  },
  {
    slug: 'ia',
    titulo: 'Modelo de IA',
    descricao: 'Modelo que gera o conteúdo dos anúncios.',
    icone: Cpu,
    Componente: SecaoIA,
  },
  {
    slug: 'membros',
    titulo: 'Membros e acessos',
    descricao: 'Convites, permissões de menu e notificações por pessoa.',
    icone: Users,
    somenteMembros: true,
    larguraCheia: true,
    Componente: SecaoMembros,
  },
];
