import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

// Mesmos textos do dossiê (src/components/sku-dossie/ads-dossie.tsx).
export const AVISO: Partial<Record<string, string>> = {
  sem_coleta: 'A coleta de Ads começa após a ativação. Os valores aparecem aqui a partir do dia seguinte.',
  sem_permissao: 'O Mercado Livre recusou a leitura de Publicidade: sem permissão de Publicidade ou conexão recusada. Reconecte a conta em Canais; se continuar, confira a permissão “Publicidade” do aplicativo.',
  sem_advertiser: 'Esta conta não tem anunciante de Product Ads no Mercado Livre. Quem ativa é o vendedor, em Meu perfil → Publicidade.',
  sem_acesso: 'A conexão com o Mercado Livre foi recusada. Reconecte a conta em Canais.',
  coletando: 'Coletando os dados de Ads da conta…',
  sem_conexao: 'Conecte sua conta do Mercado Livre em Canais para ver as campanhas.',
};

// Sem acesso à Publicidade do ML: o que resolve é reconectar em Canais (sem anunciante, só o vendedor no ML).
const PEDE_CANAIS: readonly string[] = ['sem_conexao', 'sem_permissao', 'sem_acesso'];

/** Aviso de acesso com o caminho de recuperação do estado (Abrir Canais quando reconectar resolve). */
export function AvisoAcesso({ estado }: { estado: string }) {
  return (
    <Aviso texto={AVISO[estado] ?? 'Não foi possível ler os dados de Ads no Mercado Livre.'} acao={PEDE_CANAIS.includes(estado) && (
      <Button asChild variant="outline" size="sm" className="h-11 sm:h-8"><Link to="/configuracoes/canais">Abrir Canais</Link></Button>
    )} />
  );
}

/** Estado sem números: explicação e, quando houver, a única ação que resolve. */
export function Aviso({ texto, acao }: { texto: string; acao?: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      <p>{texto}</p>
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  );
}
