import { HashRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AppShell } from '@/components/app-shell';
import { AdminShell } from '@/components/admin-shell';
import { ProtectedRoute } from '@/components/protected-route';
import { SuperAdminRoute } from '@/components/super-admin-route';
import { MenuGuard } from '@/components/menu-guard';

// Páginas carregadas sob demanda (code-splitting): tira recharts/jspdf/xlsx do bundle inicial.
const Login = lazy(() => import('@/pages/Login'));
const DefinirSenha = lazy(() => import('@/pages/DefinirSenha'));
const ResetSenha = lazy(() => import('@/pages/ResetSenha'));
const Usuarios = lazy(() => import('@/pages/Usuarios'));
const Organizacoes = lazy(() => import('@/pages/Organizacoes'));
const SemAcesso = lazy(() => import('@/pages/SemAcesso'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Lotes = lazy(() => import('@/pages/Lotes'));
const Progresso = lazy(() => import('@/pages/Progresso'));
const Revisao = lazy(() => import('@/pages/Revisao'));
const RevisaoIndex = lazy(() => import('@/pages/RevisaoIndex'));
const Relatorio = lazy(() => import('@/pages/Relatorio'));
const Configuracoes = lazy(() => import('@/pages/Configuracoes'));
const Publicados = lazy(() => import('@/pages/Publicados'));
const DetalheVendas = lazy(() => import('@/pages/DetalheVendas'));
const Faturamento = lazy(() => import('@/pages/Faturamento'));
const Financeiro = lazy(() => import('@/pages/Financeiro'));
const DetalheFinanceiro = lazy(() => import('@/pages/DetalheFinanceiro'));
const Viabilidade = lazy(() => import('@/pages/Viabilidade'));
const StyleGuide = lazy(() => import('@/pages/StyleGuide'));
const NotFound = lazy(() => import('@/pages/NotFound'));

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><div className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground" /></div>}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/definir-senha" element={<DefinirSenha />} />
      <Route path="/reset-senha" element={<ResetSenha />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/sem-acesso" element={<SemAcesso />} />
        <Route element={<AppShell />}>
          <Route element={<MenuGuard />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/lotes" element={<Lotes />} />
            <Route path="/novo-lote" element={<Lotes />} />
            <Route path="/progresso/:loteId" element={<Progresso />} />
            <Route path="/revisao" element={<RevisaoIndex />} />
            <Route path="/revisao/:loteId" element={<Revisao />} />
            <Route path="/relatorio/:loteId" element={<Relatorio />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
            <Route path="/publicados" element={<Publicados />} />
            <Route path="/publicados/vendas" element={<DetalheVendas />} />
            <Route path="/faturamento" element={<Faturamento />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/financeiro/detalhe" element={<DetalheFinanceiro />} />
            <Route path="/viabilidade" element={<Viabilidade />} />
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/style-guide" element={<StyleGuide />} />
          </Route>
        </Route>

        {/* Painel de plataforma (super-admin, D-E7.8): layout próprio, fora da operação de empresa. */}
        <Route element={<SuperAdminRoute />}>
          <Route element={<AdminShell />}>
            <Route path="/admin" element={<Organizacoes />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}

export default App;
