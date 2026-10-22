// Pós-build: `extensao/dist` precisa carregar no Chrome e não pode falar com o endpoint de token.
// - Chrome recusa arquivo/pasta com prefixo `_` dentro da extensão.
// - Nunca refresh token (ADR-0189 D-4).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '../dist');
const proibidos = ['refresh_token', '/auth/v1/token'];
const erros = [];

(function andar(dir) {
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (nome.startsWith('_')) erros.push(`nome com prefixo _: ${path.relative(dist, p)}`);
    if (statSync(p).isDirectory()) { andar(p); continue; }
    const texto = readFileSync(p, 'utf8');
    for (const s of proibidos) if (texto.includes(s)) erros.push(`${path.relative(dist, p)} contém ${s}`);
  }
})(dist);

if (!statSync(path.join(dist, 'manifest.json'), { throwIfNoEntry: false })) erros.push('manifest.json ausente');
if (erros.length) {
  console.error('[checar-dist] reprovado:\n' + erros.join('\n'));
  process.exit(1);
}
console.log('[checar-dist] ok');
