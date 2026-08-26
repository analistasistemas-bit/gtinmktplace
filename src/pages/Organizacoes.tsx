import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { LISTA_CANAIS } from '@/lib/canais';
import { MODULOS } from '@/lib/modulos';
import { CanalBadge } from '@/components/canal-badge';
import { cancelSupport, listSupportRequests, requestSupport, type SupportRequest, type SupportScope } from '@/lib/suporte';
import { useSupportStore } from '@/stores/support-store';

interface OrgRow {
  id: string;
  nome: string;
  slug: string;
  membros: number;
  criado_em: string;
  canais_habilitados: string[];
  modulos_habilitados: string[];
  is_test: boolean;
  tipo_pessoa: 'pf' | 'pj' | null;
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
  const navigate = useNavigate();
  const startSupport = useSupportStore((state) => state.start);
  const [novaOpen, setNovaOpen] = useState(false);
  const [delOrg, setDelOrg] = useState<OrgRow | null>(null);
  const [canaisOrg, setCanaisOrg] = useState<OrgRow | null>(null);
  const [modulosOrg, setModulosOrg] = useState<OrgRow | null>(null);
  const [supportOrg, setSupportOrg] = useState<OrgRow | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['organizacoes'],
    queryFn: async (): Promise<OrgRow[]> => {
      const data = await callUsuarios({ action: 'list_orgs' });
      return (data?.orgs ?? []) as OrgRow[];
    },
  });

  const support = useQuery<SupportRequest[]>({
    queryKey: ['support-requests'],
    queryFn: async () => {
      const requests: SupportRequest[] = [];
      let page = 1;
      for (;;) {
        const result = await listSupportRequests({ page, pageSize: 50, status: 'actionable' });
        requests.push(...result.requests);
        if (requests.length >= result.total || result.requests.length === 0) break;
        page += 1;
      }
      return requests;
    },
  });
  const supportByOrg = (support.data ?? []).reduce<Map<string, SupportRequest>>((requests, request) => {
    if (!requests.has(request.org_id)) requests.set(request.org_id, request);
    return requests;
  }, new Map());

  async function enterOperation(request: SupportRequest) {
    try {
      await startSupport(request.id);
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível iniciar o suporte.');
      await qc.invalidateQueries({ queryKey: ['support-requests'] });
    }
  }

  async function handleTipoPessoa(org: OrgRow, tipo: 'pf' | 'pj') {
    try {
      await callUsuarios({ action: 'set_tipo_pessoa_org', org_id: org.id, tipo_pessoa: tipo });
      toast.success('✓ Tipo de pessoa atualizado');
      await qc.invalidateQueries({ queryKey: ['organizacoes'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar tipo de pessoa');
    }
  }

  async function cancelRequest(request: SupportRequest) {
    setCancellingRequestId(request.id);
    try {
      await cancelSupport(request.id);
      toast.success('Solicitação cancelada.');
      await qc.invalidateQueries({ queryKey: ['support-requests'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível cancelar a solicitação.');
    } finally {
      setCancellingRequestId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-6">
      <PageHeader
        title="Organizações"
        subtitle="Empresas que usam o PubliAI (visão exclusiva de super-admin)."
        actions={<Button onClick={() => setNovaOpen(true)}>Nova empresa</Button>}
      />

      <Card className="mt-4 overflow-hidden">
        <Table className="md:min-w-[72rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead className="hidden md:table-cell">Slug</TableHead>
              <TableHead className="hidden md:table-cell">Membros</TableHead>
              <TableHead className="hidden md:table-cell">Tipo</TableHead>
              <TableHead className="hidden md:table-cell">Canais</TableHead>
              <TableHead className="hidden md:table-cell">Criada em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : orgs.map((o) => {
              const request = supportByOrg.get(o.id);
              const canStart = request?.status === 'approved'
                && !!request.approval_expires_at
                && new Date(request.approval_expires_at).getTime() > Date.now();
              const canRenew = request?.status === 'active'
                && !!request.expires_at
                && new Date(request.expires_at).getTime() > Date.now()
                && new Date(request.expires_at).getTime() - Date.now() <= 15 * 60_000;
              return (
              <TableRow key={o.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">{o.nome}{o.is_test && <Badge variant="outline">Teste</Badge>}</div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{o.slug}</TableCell>
                <TableCell className="hidden md:table-cell">{o.membros}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <select
                    aria-label={`Tipo de pessoa de ${o.nome}`}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={o.tipo_pessoa ?? 'pf'}
                    onChange={(e) => handleTipoPessoa(o, e.target.value as 'pf' | 'pj')}
                  >
                    <option value="pf">Pessoa física</option>
                    <option value="pj">Pessoa jurídica</option>
                  </select>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {(o.canais_habilitados ?? ['mercado_livre']).map((c) => <CanalBadge key={c} canal={c} />)}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{new Date(o.criado_em).toLocaleDateString('pt-BR')}</TableCell>
                <TableCell className="w-full whitespace-normal md:min-w-[32rem]">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setCanaisOrg(o)}>Canais</Button>
                    <Button variant="ghost" size="sm" onClick={() => setModulosOrg(o)}>Módulos</Button>
                    {request && <span className="text-xs text-muted-foreground">{supportStatus(request.status)} · {scopeLabel(request.scope)}</span>}
                    {request?.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancellingRequestId === request.id}
                        onClick={() => cancelRequest(request)}
                      >
                        {cancellingRequestId === request.id ? 'Cancelando…' : 'Cancelar solicitação'}
                      </Button>
                    )}
                    {canStart ? <Button size="sm" onClick={() => enterOperation(request)}>Entrar na operação</Button> : canRenew ? <Button variant="outline" size="sm" onClick={() => setSupportOrg(o)}>Solicitar renovação</Button> : !request || !['pending', 'active'].includes(request.status) ? <Button variant="outline" size="sm" onClick={() => setSupportOrg(o)}>Solicitar acesso</Button> : null}
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDelOrg(o)}>Excluir</Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
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
      <ModulosOrgDialog
        org={modulosOrg}
        onClose={() => setModulosOrg(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })}
      />
      <SupportRequestDialog
        org={supportOrg}
        onClose={() => setSupportOrg(null)}
        onRequested={async () => {
          setSupportOrg(null);
          await qc.invalidateQueries({ queryKey: ['support-requests'] });
        }}
      />
      {support.isError && <p className="mt-2 text-sm text-destructive" role="alert">Não foi possível carregar o estado das solicitações.</p>}
    </div>
  );
}

const supportStatus = (status: SupportRequest['status']) => ({
  pending: 'Aguardando aprovação', approved: 'Aprovada', active: 'Acesso ativo', rejected: 'Rejeitada',
  cancelled: 'Cancelada', expired: 'Expirada', revoked: 'Revogada', ended: 'Encerrada',
})[status];

const scopeLabel = (scope: SupportScope) => scope === 'read' ? 'Somente leitura' : 'Acesso total';

function SupportRequestDialog({ org, onClose, onRequested }: {
  org: OrgRow | null;
  onClose: () => void;
  onRequested: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<SupportScope>('read');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setReason(''); setScope('read'); setError(null); }, [org?.id]);

  async function submit() {
    if (!org) return;
    if (!reason.trim()) {
      setError('Informe o motivo do acesso.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await requestSupport({ orgId: org.id, scope, reason: reason.trim() });
      toast.success('Solicitação enviada para os administradores da organização.');
      await onRequested();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Solicitar acesso a {org?.nome}</DialogTitle><DialogDescription>O acesso só começa após aprovação de um administrador da organização.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Escopo do acesso</p>
            <label className="flex items-center gap-2 text-sm" htmlFor="support-scope-read">
              <input id="support-scope-read" name="support-scope" type="radio" value="read" checked={scope === 'read'} onChange={() => setScope('read')} />
              Somente leitura
            </label>
            <label className="flex items-center gap-2 text-sm" htmlFor="support-scope-full">
              <input id="support-scope-full" name="support-scope" type="radio" value="full" checked={scope === 'full'} onChange={() => setScope('full')} />
              Acesso total
            </label>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="support-reason">Motivo do acesso</label>
            <textarea id="support-reason" className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive" role="alert" aria-live="polite">{error}</p>}
          <p className="text-xs text-muted-foreground">A solicitação expira em 24 horas. Após aprovada, ela deve ser iniciada em até 1 hora.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Enviando…' : 'Enviar solicitação'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

// E6b (D-13): módulos pagos por org. Espelha CanaisOrgDialog, com uma diferença
// proposital — não existe módulo obrigatório, lista vazia é o default de toda org.
function ModulosOrgDialog({ org, onClose, onSaved }: {
  org: OrgRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [modulos, setModulos] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (org) setModulos(new Set(org.modulos_habilitados ?? []));
  }, [org]);

  async function salvar() {
    if (!org) return;
    setSalvando(true);
    try {
      await callUsuarios({ action: 'set_modulos_org', org_id: org.id, modulos: [...modulos] });
      toast.success('✓ Módulos atualizados');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar módulos');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Módulos de {org?.nome}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Módulos pagos desta empresa. Desligar esconde o menu e faz as edges do módulo
          recusarem chamadas dessa empresa — o dado já gravado não é apagado.
        </p>
        <div className="flex flex-col gap-2">
          {MODULOS.map((m) => (
            <label key={m.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={modulos.has(m.id)}
                onCheckedChange={(v) => setModulos((prev) => {
                  const novo = new Set(prev);
                  if (v === true) novo.add(m.id); else novo.delete(m.id);
                  return novo;
                })}
              />
              <span>
                {m.nome}
                <span className="block text-xs text-muted-foreground">{m.descricao}</span>
              </span>
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
