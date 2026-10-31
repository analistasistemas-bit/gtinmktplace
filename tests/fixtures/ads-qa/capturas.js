// Capturas e medições do QA do /ads. Rodar depois de instalar-rotas.js, na mesma sessão (ver instruções lá).
// Saída: prints fix2-*.png em OUT e um JSON com contraste (pills, selecionado, gráfico) e alvos de toque < 44 px.
// Alvos de toque: ver capturas-toque.js (precisa de contexto com hasTouch).
async page => {
  const OUT = '/Users/diego/.claude/jobs/7b0b2175/tmp/qa/';
  const res = {};

  // Autocontida: o Playwright serializa a função e a executa na página.
  const medir = () => {
    const cv = document.createElement('canvas').getContext('2d', { colorSpace: 'srgb' });
    const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
      const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const over = (f, b) => f.slice(0, 3).map((v, i) => v * f[3] + b[i] * (1 - f[3]));
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    const bgOf = (el) => { const cadeia = []; for (let e = el; e; e = e.parentElement) cadeia.push(rgba(getComputedStyle(e).backgroundColor));
      let base = [255, 255, 255]; for (const c of cadeia.reverse()) base = c[3] > 0 ? over(c, base) : base; return base; };
    const texto = (el) => { const bg = bgOf(el); return cr(over(rgba(getComputedStyle(el).color), bg), bg); };
    const out = { pills: {}, texto: {}, grafico: {} };
    document.querySelectorAll('[data-tone]').forEach((e) => { out.pills[e.textContent.trim().slice(0, 40)] = texto(e); });
    const ativo = document.querySelector('button[aria-pressed=true]');
    if (ativo) out.texto['ativo:' + ativo.textContent.slice(0, 30)] = texto(ativo);
    const sec = [...document.querySelectorAll('section')].find((s) => s.textContent.includes('Evolução diária'));
    if (sec) {
      const card = bgOf(sec);
      sec.querySelectorAll('.recharts-legend-item-text, .recharts-cartesian-axis-tick-text').forEach((e) => {
        const t = e.textContent.trim().slice(0, 36); if (!t) return;
        const fill = getComputedStyle(e).fill; const cor = fill && fill !== 'none' ? rgba(fill) : rgba(getComputedStyle(e).color);
        out.texto['grafico:' + t] = cr(over(cor, card), card);
      });
      sec.querySelectorAll('p').forEach((e) => { const t = e.textContent.trim().slice(0, 30); if (t) out.texto['p:' + t] = texto(e); });
      const cor = (el, prop) => { const c = getComputedStyle(el)[prop]; return c && c !== 'none' ? cr(over(rgba(c), card), card) : null; };
      sec.querySelectorAll('.recharts-bar-rectangle path, .recharts-bar-rectangle rect').forEach((e, i) => { if (i < 4) out.grafico['barra' + i] = cor(e, 'fill'); });
      sec.querySelectorAll('.recharts-line-curve').forEach((e, i) => { out.grafico['linha' + i] = cor(e, 'stroke'); });
      sec.querySelectorAll('pattern line, pattern path, pattern rect').forEach((e, i) => { out.grafico['hachura' + i] = cor(e, 'stroke') ?? cor(e, 'fill'); });
      sec.querySelectorAll('.recharts-legend-item svg *').forEach((e, i) => { if (i < 8) out.grafico['legenda-icone' + i] = cor(e, 'fill') ?? cor(e, 'stroke'); });
    }
    return out;
  };

  // 1) Desktop 1440x900, claro e escuro: primeira dobra, atalho, pills e gráfico
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:5173/#/ads?aba=desempenho');
  await page.reload();
  await page.waitForTimeout(8000);
  for (const t of ['claro', 'escuro']) {
    await page.evaluate((tema) => document.documentElement.classList.toggle('dark', tema === 'escuro'), t);
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + `fix2-p1-1440-${t}.png` });
    res['contraste_' + t] = await page.evaluate(medir);
    if (t === 'escuro') {
      const atalho = page.getByRole('button', { name: 'Ver famílias acima do equilíbrio' });
      res.atalhos_visiveis = await atalho.count();
      await atalho.first().click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: OUT + 'fix2-p1-atalho-1440-escuro.png' });
      res.filtroAplicado = await page.getByRole('button', { name: 'Remover filtro Acima do equilíbrio' }).count();
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));

  return JSON.stringify(res, null, 1);
}
