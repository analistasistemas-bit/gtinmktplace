// Pós-build: `extensao/dist` precisa carregar no Chrome e só o service worker fala com o endpoint de token.
// - Chrome recusa arquivo/pasta com prefixo `_` dentro da extensão.
// - Refresh token e /auth/v1/token só no `sw.js` (ADR-0189, emenda 2026-10-24): painel, chunks e content
//   scripts nunca (o painel não renova nem guarda credencial).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const dist = process.env.CHECAR_DIST_DIR ?? path.resolve(import.meta.dirname, '../dist'); // override: só no teste
const proibidos = ['refresh_token', '/auth/v1/token'];
const erros = [];

(function andar(dir) {
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (nome.startsWith('_')) erros.push(`nome com prefixo _: ${path.relative(dist, p)}`);
    if (statSync(p).isDirectory()) { andar(p); continue; }
    if (path.relative(dist, p) === 'sw.js') continue;
    const texto = readFileSync(p, 'utf8');
    for (const s of proibidos) if (texto.includes(s)) erros.push(`${path.relative(dist, p)} contém ${s}`);
  }
})(dist);

const manifestPath = path.join(dist, 'manifest.json');
if (!statSync(manifestPath, { throwIfNoEntry: false })) erros.push('manifest.json ausente');
// Build de produção nunca aceita sessão de localhost (só o de desenvolvimento, que recebe "development").
else if (process.argv[2] !== 'development'
  && (JSON.parse(readFileSync(manifestPath, 'utf8')).externally_connectable?.matches ?? []).some((m) => m.includes('localhost'))) {
  erros.push('manifest de produção com localhost em externally_connectable');
}
// Content scripts MV3 não são módulos: precisam existir e não ter import/export.
for (const f of ['anuncio.js', 'busca-ean.js', 'cabecalho.js']) {
  const p = path.join(dist, f);
  if (!statSync(p, { throwIfNoEntry: false })) { erros.push(`${f} ausente`); continue; }
  if (/(^|[;}\n])\s*(import\s*[\w{*"']|export\s*[\w{*])/.test(readFileSync(p, 'utf8'))) erros.push(`${f} contém import/export`);
}
if (erros.length) {
  console.error('[checar-dist] reprovado:\n' + erros.join('\n'));
  process.exit(1);
}
console.log('[checar-dist] ok');
