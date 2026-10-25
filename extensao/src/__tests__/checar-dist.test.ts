import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../../scripts/checar-dist.mjs');
const AUTH = 'fetch(u+"/auth/v1/token?grant_type=refresh_token",{body:JSON.stringify({refresh_token:r})})';
let dist: string;

const escrever = (rel: string, texto: string) => {
  mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
  writeFileSync(path.join(dist, rel), texto);
};
const checar = () => spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, CHECAR_DIST_DIR: dist }, encoding: 'utf8' });

beforeEach(() => {
  dist = mkdtempSync(path.join(tmpdir(), 'checar-dist-'));
  escrever('manifest.json', JSON.stringify({ externally_connectable: { matches: ['https://app.publiai.daludi.com.br/*'] } }));
  escrever('anuncio.js', '(()=>{})();');
  escrever('busca-ean.js', '(()=>{})();');
  escrever('sw.js', AUTH);
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

describe('checar-dist: auth só no sw.js', () => {
  it('endpoint de token e refresh_token no sw.js passam', () => {
    const r = checar();
    expect(r.stdout).toContain('[checar-dist] ok');
    expect(r.status).toBe(0);
  });

  it.each(['painel.js', 'chunks/c-abc.js', 'anuncio.js', 'busca.js', 'src/painel/index.html', 'pasta/sw.js'])('em %s reprova', (rel) => {
    escrever(rel, AUTH);
    const r = checar();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${rel} contém /auth/v1/token`);
    expect(r.stderr).toContain(`${rel} contém refresh_token`);
    expect(r.stderr).not.toMatch(/^sw\.js contém/m);
  });
});
