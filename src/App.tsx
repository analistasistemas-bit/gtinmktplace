import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import Dashboard from '@/pages/Dashboard';
import NovoLote from '@/pages/NovoLote';
import Progresso from '@/pages/Progresso';
import Revisao from '@/pages/Revisao';
import Relatorio from '@/pages/Relatorio';
import Configuracoes from '@/pages/Configuracoes';
import NotFound from '@/pages/NotFound';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/novo-lote" element={<NovoLote />} />
        <Route path="/progresso/:loteId" element={<Progresso />} />
        <Route path="/revisao/:loteId" element={<Revisao />} />
        <Route path="/relatorio/:loteId" element={<Relatorio />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
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
