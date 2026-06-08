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
