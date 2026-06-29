import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { MENU_KEYS, type MenuKey } from '@/lib/menus';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const MENU_LABEL: Record<MenuKey, string> = {
  dashboard: 'Dashboard', lotes: 'Lotes', revisao: 'Revisão', publicados: 'Publicados',
  faturamento: 'Faturamento', financeiro: 'Financeiro', viabilidade: 'Viabilidade',
  configuracoes: 'Configurações', usuarios: 'Usuários',
};

interface UserRow {
  id: string;
  email: string | null;
  nome: string;
  is_admin: boolean;
  is_active: boolean;
  allowed_menus: string[];
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

function MenuChecklist({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  function toggle(key: string, on: boolean) {
    onChange(on ? [...value, key] : value.filter((k) => k !== key));
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {MENU_KEYS.map((key) => (
        <label key={key} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
          <Checkbox checked={value.includes(key)} disabled={disabled} onCheckedChange={(c) => toggle(key, c === true)} />
          {MENU_LABEL[key]}
        </label>
      ))}
    </div>
  );
}

export default function Usuarios() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: async (): Promise<UserRow[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,email,nome,is_admin,is_active,allowed_menus')
        .order('created_at');
      if (error) throw error;
      return data as UserRow[];
    },
  });

  async function run(body: Record<string, unknown>, sucesso: string): Promise<boolean> {
    try {
      await callUsuarios(body);
      toast.success(sucesso);
      await qc.invalidateQueries({ queryKey: ['profiles'] });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na operação');
      return false;
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <PageHeader
        title="Usuários"
        subtitle="Convide membros e defina quais menus cada um acessa."
        actions={<Button onClick={() => setInviteOpen(true)}>Convidar usuário</Button>}
      />

      <Card className="mt-4 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Menus</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : usuarios.map((u) => {
              const isSelf = u.id === user?.id;
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.nome || '—'}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    {u.is_admin ? (
                      <span className="text-xs text-muted-foreground">todos</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.allowed_menus.length === 0
                          ? <span className="text-xs text-muted-foreground">nenhum</span>
                          : u.allowed_menus.map((m) => <Badge key={m} variant="secondary">{MENU_LABEL[m as MenuKey] ?? m}</Badge>)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.is_admin}
                      disabled={isSelf}
                      onCheckedChange={(c) => run({ action: 'set_admin', id: u.id, is_admin: c }, 'Permissão de admin atualizada')}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.is_active}
                      disabled={isSelf}
                      onCheckedChange={(c) => run({ action: 'set_active', id: u.id, is_active: c }, 'Status atualizado')}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled={u.is_admin} onClick={() => setEditUser(u)}>
                      Editar menus
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onSubmit={run} />
      <EditMenusDialog user={editUser} onClose={() => setEditUser(null)} onSubmit={run} />
    </div>
  );
}

function InviteDialog({ open, onOpenChange, onSubmit }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (body: Record<string, unknown>, sucesso: string) => Promise<boolean>;
}) {
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [menus, setMenus] = useState<string[]>([]);
  const [admin, setAdmin] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // Admin vê tudo: ao ligar, marca (e trava) todos os menus.
  function toggleAdmin(on: boolean) {
    setAdmin(on);
    if (on) setMenus([...MENU_KEYS]);
  }

  async function enviar() {
    setEnviando(true);
    const ok = await onSubmit({ action: 'invite', email, nome, allowed_menus: menus, is_admin: admin }, 'Convite enviado');
    setEnviando(false);
    if (ok) {
      setEmail(''); setNome(''); setMenus([]); setAdmin(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Convidar usuário</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input type="email" placeholder="email@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
            <span className="font-medium">Administrador <span className="font-normal text-muted-foreground">(acesso total a todos os menus)</span></span>
            <Switch checked={admin} onCheckedChange={toggleAdmin} />
          </label>
          <div>
            <div className="mb-2 text-sm font-medium">Menus</div>
            <MenuChecklist value={menus} onChange={setMenus} disabled={admin} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={enviar} disabled={!email || enviando}>{enviando ? 'Enviando…' : 'Enviar convite'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditMenusDialog({ user, onClose, onSubmit }: {
  user: UserRow | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>, sucesso: string) => Promise<boolean>;
}) {
  const [menus, setMenus] = useState<string[]>([]);
  const [nome, setNome] = useState('');
  const [carregado, setCarregado] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Sincroniza o estado local quando abre p/ outro usuário.
  if (user && carregado !== user.id) {
    setMenus(user.allowed_menus);
    setNome(user.nome);
    setCarregado(user.id);
  }

  async function salvar() {
    if (!user) return;
    setSalvando(true);
    const ok = await onSubmit({ action: 'update_menus', id: user.id, nome, allowed_menus: menus }, 'Menus atualizados');
    setSalvando(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar menus — {user?.nome || user?.email}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <MenuChecklist value={menus} onChange={setMenus} />
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
