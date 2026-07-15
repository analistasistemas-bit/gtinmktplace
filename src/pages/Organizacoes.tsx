import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useProfile } from '@/hooks/useProfile';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { LISTA_CANAIS } from '@/lib/canais';
import { CanalBadge } from '@/components/canal-badge';

interface OrgRow {
  id: string;
  nome: string;
  slug: string;
  membros: number;
  criado_em: string;
  canais_habilitados: string[];
}

async function callUsuarios(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('usuarios', { body });
  if (error) {
    // Em respostas não-2xx o invoke não popula `data`; a mensagem real está no corpo (error.context).
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      } catch {
        /* mantém error.message */
      }
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function Organizacoes() {
  const qc = useQueryClient();
  const { profile } = useProfile();
  const [novaOpen, setNovaOpen] = useState(false);
  const [delOrg, setDelOrg] = useState<OrgRow | null>(null);
  const [canaisOrg, setCanaisOrg] = useState<OrgRow | null>(null);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['organizacoes'],
    queryFn: async (): Promise<OrgRow[]> => {
      const data = await callUsuarios({ action: 'list_orgs' });
      return (data?.orgs ?? []) as OrgRow[];
    },
  });

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <PageHeader
        title="Organizações"
        subtitle="Empresas que usam o PubliAI (visão exclusiva de super-admin)."
        actions={<Button onClick={() => setNovaOpen(true)}>Nova empresa</Button>}
      />

      <Card className="mt-4 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Membros</TableHead>
              <TableHead>Canais</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : orgs.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.nome}</TableCell>
                <TableCell className="text-muted-foreground">{o.slug}</TableCell>
                <TableCell>{o.membros}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(o.canais_habilitados ?? ['mercado_livre']).map((c) => <CanalBadge key={c} canal={c} />)}
                  </div>
                </TableCell>
                <TableCell>{new Date(o.criado_em).toLocaleDateString('pt-BR')}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setCanaisOrg(o)}>Canais</Button>
                  {profile?.org_id === o.id ? (
                    <span className="text-xs text-muted-foreground">sua empresa</span>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDelOrg(o)}>
                      Excluir
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <NovaOrgDialog
        open={novaOpen}
        onOpenChange={setNovaOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })}
      />
      <ExcluirOrgDialog
        org={delOrg}
        onClose={() => setDelOrg(null)}
        onDeleted={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })}
      />
      <CanaisOrgDialog
        org={canaisOrg}
        onClose={() => setCanaisOrg(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })}
      />
    </div>
  );
}

function ExcluirOrgDialog({ org, onClose, onDeleted }: {
  org: OrgRow | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmSlug, setConfirmSlug] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  useEffect(() => { setConfirmSlug(''); }, [org?.id]);

  async function excluir() {
    if (!org) return;
    setExcluindo(true);
    try {
      await callUsuarios({ action: 'delete_org', org_id: org.id });
      toast.success('✓ Empresa excluída');
      onClose();
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao excluir empresa');
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Excluir {org?.nome}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Isto apaga <strong>todos os dados</strong> da empresa (lotes, anúncios, vendas, usuários)
            e <strong>não pode ser desfeito</strong>. Anúncios já publicados no marketplace <strong>não</strong> são
            removidos de lá — só os registros locais.
          </p>
          <p className="text-muted-foreground">
            Para confirmar, digite o slug <code className="rounded bg-muted px-1 text-foreground">{org?.slug}</code>:
          </p>
          <Input value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} placeholder={org?.slug} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={excluindo}>Cancelar</Button>
          <Button variant="destructive" onClick={excluir} disabled={confirmSlug !== org?.slug || excluindo}>
            {excluindo ? 'Excluindo…' : 'Excluir empresa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovaOrgDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [marcaPadrao, setMarcaPadrao] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminNome, setAdminNome] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function criar() {
    setEnviando(true);
    try {
      await callUsuarios({
        action: 'create_org',
        nome,
        slug,
        marca_padrao: marcaPadrao,
        admin_email: adminEmail,
        admin_nome: adminNome,
      });
      toast.success('✓ Empresa criada');
      setNome(''); setSlug(''); setMarcaPadrao(''); setAdminEmail(''); setAdminNome('');
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar empresa');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova empresa</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input placeholder="Nome da empresa" value={nome} onChange={(e) => setNome(e.target.value)} />
          <Input placeholder="Slug (ex.: minha-empresa)" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <Input placeholder="Marca padrão (ex.: MinhaMarca)" value={marcaPadrao} onChange={(e) => setMarcaPadrao(e.target.value)} />
          <Input type="email" placeholder="E-mail do primeiro admin" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          <Input placeholder="Nome do primeiro admin" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={!nome || !slug || !adminEmail || enviando}>
            {enviando ? 'Criando…' : 'Criar empresa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CanaisOrgDialog({ org, onClose, onSaved }: {
  org: OrgRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [canais, setCanais] = useState<Set<string>>(new Set(['mercado_livre']));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (org) setCanais(new Set(org.canais_habilitados ?? ['mercado_livre']));
  }, [org]);

  async function salvar() {
    if (!org) return;
    setSalvando(true);
    try {
      await callUsuarios({ action: 'set_canais_org', org_id: org.id, canais: [...canais] });
      toast.success('✓ Canais atualizados');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar canais');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Canais de {org?.nome}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Canais que esta empresa enxerga como conectáveis. Canal "em breve" no produto continua
          em breve mesmo habilitado aqui — isto controla o rollout quando o canal for lançado.
        </p>
        <div className="flex flex-col gap-2">
          {LISTA_CANAIS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={canais.has(c.id)}
                disabled={c.id === 'mercado_livre'}
                onCheckedChange={(v) => setCanais((prev) => {
                  const novo = new Set(prev);
                  if (v === true) novo.add(c.id); else novo.delete(c.id);
                  return novo;
                })}
              />
              {c.nome}
              {c.id === 'mercado_livre' && <span className="text-xs text-muted-foreground">(sempre ativo)</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
