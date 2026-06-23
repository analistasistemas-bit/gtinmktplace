import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { ProtectedRoute } from '@/components/protected-route';
import Login from '@/pages/Login';
import Cadastro from '@/pages/Cadastro';
import ResetSenha from '@/pages/ResetSenha';
import Dashboard from '@/pages/Dashboard';
import NovoLote from '@/pages/NovoLote';
import Progresso from '@/pages/Progresso';
import Revisao from '@/pages/Revisao';
import RevisaoIndex from '@/pages/RevisaoIndex';
import Relatorio from '@/pages/Relatorio';
import Configuracoes from '@/pages/Configuracoes';
import Publicados from '@/pages/Publicados';
import DetalheVendas from '@/pages/DetalheVendas';
import Faturamento from '@/pages/Faturamento';
import Financeiro from '@/pages/Financeiro';
import DetalheFinanceiro from '@/pages/DetalheFinanceiro';
import Viabilidade from '@/pages/Viabilidade';
import StyleGuide from '@/pages/StyleGuide';
import NotFound from '@/pages/NotFound';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route path="/reset-senha" element={<ResetSenha />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/novo-lote" element={<NovoLote />} />
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
          <Route path="/style-guide" element={<StyleGuide />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
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
