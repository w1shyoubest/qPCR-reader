(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f2 = v => v == null || !Number.isFinite(v) ? '—' : v.toFixed(2);
  const sgn = v => v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2);
  const TPAL = ['#B0171F', '#1F3FD1', '#0A8A4E', '#7B2CBF', '#C2650A', '#0E7490', '#9D174D', '#4D7C0F'];
  const SPAL = ['#185FA5', '#D85A30', '#1D9E75', '#BA7517', '#7F77DD', '#D4537E', '#639922', '#E24B4A', '#378ADD', '#5DCAA5', '#3C3489', '#888780', '#EF9F27', '#993556', '#0F6E56', '#854F0B', '#534AB7', '#A32D2D', '#2B6CB0', '#B7791F'];
  const PPAL = ['#1F3FD1', '#C2650A', '#0A8A4E', '#9D174D', '#7B2CBF', '#0E7490', '#4D7C0F', '#B0171F'];
  const ROWL = 'ABCDEFGHIJKLMNOP';
  const css = () => getComputedStyle(document.documentElement);
  const cv = n => css().getPropertyValue(n).trim();
  const key = w => w.pos + '|' + w.target;

  const plates = []; let active = null, nextId = 1;
  const charts = {};
  const cmp = { cal: {}, metric: 'fold', overlay: new Set(), otargets: new Set() };

  // ---------- plate objects ----------
  function newPlate(data, file) {
    const P = { id: nextId++, file, name: file.replace(/\.[^.]+$/, ''), data, sel: new Set(),
      opt: { thMode: 'shared', threshold: 0.2, thByT: {}, baseline: 'instrument', bStart: 3, bEnd: 8, excluded: {} },
      delta: { target: '', ref: '', controls: {}, metric: 'dct' },
      view: { scale: 'log', colorBy: 'target', plot: 'drn', samples: null, targets: null, showExcluded: false } };
    const at = QPCR.autoThreshold(data.wells, P.opt); P.opt.threshold = at.value; P.anyAmp = at.anyAmp;
    P.an = QPCR.analyze(data, P.opt);
    P.an.targets.forEach(t => P.opt.thByT[t] = QPCR.autoThreshold(data.wells, P.opt, t).value);
    P.view.samples = new Set(P.an.samples); P.view.targets = new Set(P.an.targets);
    P.delta.target = P.an.targets.find(t => /k4me1|me1/i.test(t)) || P.an.targets[0];
    P.delta.ref = P.an.targets.find(t => /unmod/i.test(t)) || P.an.targets.find(t => t !== P.delta.target) || P.an.targets[0];
    // default controls: pair antibody samples with an IgG of the same prefix when obvious
    return P;
  }
  const cur = () => plates.find(p => p.id === active);
  const tColor = (P, t) => TPAL[P.an.targets.indexOf(t) % TPAL.length];
  const sColor = (P, s) => SPAL[P.an.samples.indexOf(s) % SPAL.length];
  const pColor = P => PPAL[(P.id - 1) % PPAL.length];
  function recompute(P) { P.an = QPCR.analyze(P.data, P.opt); }

  // ---------- loading ----------
  async function loadFiles(files) {
    const status = $('#status'); const errs = []; let first = null;
    for (const file of files) {
      status.textContent = 'Reading ' + file.name + '…'; status.className = 'status';
      try {
        const buf = await file.arrayBuffer();
        const data = /\.eds$/i.test(file.name) ? await QPCR.parseEDS(buf, JSZip) : QPCR.parseSheet(new Uint8Array(buf), XLSX);
        if (!data.wells.length) throw new Error('no wells with sample names and amplification data');
        const P = newPlate(data, file.name); plates.push(P); if (first == null) first = P.id;
      } catch (e) { errs.push(`${file.name}: ${e.message || e}`); }
    }
    if (first != null) active = first;
    status.textContent = errs.join(' · '); status.className = errs.length ? 'status error' : 'status';
    if (plates.length) { $('#app').hidden = false; $('#intro').classList.add('compact'); }
    render();
  }
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); loadFiles([...e.dataTransfer.files]); });
  $('#file').addEventListener('change', e => { loadFiles([...e.target.files]); e.target.value = ''; });

  // ---------- tabs ----------
  function renderTabs() {
    const t = plates.map(P => `<span class="tab ${P.id === active ? 'on' : ''}" data-id="${P.id}" role="tab" tabindex="0" aria-selected="${P.id === active}"><i class="dot" style="--c:${pColor(P)}"></i>${esc(P.name)}<button class="x" data-close="${P.id}" aria-label="Close ${esc(P.name)}">×</button></span>`).join('');
    $('#tabs').innerHTML = t + (plates.length > 1 ? `<span class="tab cmp ${active === 'compare' ? 'on' : ''}" data-id="compare" role="tab" tabindex="0" aria-selected="${active === 'compare'}">Compare plates (${plates.length})</span>` : '');
    $('#tabs').querySelectorAll('.tab').forEach(el => {
      const go = () => { active = el.dataset.id === 'compare' ? 'compare' : +el.dataset.id; render(); };
      el.addEventListener('click', e => { if (!e.target.dataset.close) go(); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    $('#tabs').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); const id = +b.dataset.close; const i = plates.findIndex(p => p.id === id); plates.splice(i, 1);
      [...cmp.overlay].filter(k => k.startsWith(id + '|')).forEach(k => cmp.overlay.delete(k));
      if (active === id || (active === 'compare' && plates.length < 2)) active = plates.length ? plates[Math.max(0, i - 1)].id : null;
      if (!plates.length) { $('#app').hidden = true; $('#intro').classList.remove('compact'); }
      render();
    }));
  }

  function render() {
    renderTabs();
    if (!plates.length) return;
    const isCmp = active === 'compare';
    $('#plateview').hidden = isCmp; $('#compareview').hidden = !isCmp;
    if (isCmp) renderCompare(); else renderPlate(cur());
  }

  // =================== single plate ===================
  function renderPlate(P) { renderInfo(P); renderSettings(P); renderLayout(P); renderFilters(P); renderChart(P); renderQC(P); renderDelta(P); renderSummary(P); renderWells(P); }

  function runText(P) {
    const i = P.data.info || {};
    return i.end ? i.end.toLocaleString() : i.endText ? String(i.endText) : '';
  }
  function renderInfo(P) {
    const nW = new Set(P.data.wells.map(w => w.pos)).size, i = P.data.info || {};
    $('#runinfo').innerHTML = `<b>${esc(P.file)}</b> · ${nW} wells · ${P.data.nrow * P.data.ncol}-well plate${runText(P) ? ' · run ended ' + esc(runText(P)) : ''}${i.type ? ' · ' + esc(i.type) : ''} · passive reference: ${esc(P.data.passive || 'none')} · targets: ${P.an.targets.map(t => `<span class="chip" style="--c:${tColor(P, t)}">${esc(t)}</span>`).join(' ')}`;
    const pt = i.protocol ? QPCR.protocolText(i.protocol) : '';
    $('#method').innerHTML = pt ? `<b>Run method</b> · ${esc(i.protocol.mode)} mode · ${esc(i.protocol.volume)} µL · ${esc(pt)} <span class="hint">(● = data collection)</span>` : `<span class="hint">Run method is only stored in .eds files.</span>`;
    const warn = [];
    if (!P.anyAmp) warn.push('No well shows amplification. Check that the probe was added to the premix and that the plate was in the instrument.');
    if (!P.data.passive) warn.push('Passive reference was not set in this run, so Rn is not ROX-normalized. Set it to ROX for future runs.');
    $('#warn').innerHTML = warn.map(w => `<p>${esc(w)}</p>`).join(''); $('#warn').hidden = !warn.length;
  }

  function renderSettings(P) {
    document.querySelectorAll('input[name=thm]').forEach(r => r.checked = r.value === P.opt.thMode);
    $('#thshared').hidden = P.opt.thMode !== 'shared';
    $('#th').value = +P.opt.threshold.toPrecision(3);
    $('#thtarget').hidden = P.opt.thMode !== 'target';
    $('#thtarget').innerHTML = P.an.targets.map(t => `<label><i class="dot" style="--c:${tColor(P, t)}"></i>${esc(t)} <input type="number" step="any" min="0" data-tt="${esc(t)}" value="${+(P.opt.thByT[t] || P.opt.threshold).toPrecision(3)}"></label>`).join('');
    $('#thtarget').querySelectorAll('input').forEach(i => i.addEventListener('change', () => { const v = parseFloat(i.value); if (v > 0) { P.opt.thByT[i.dataset.tt] = v; recompute(P); renderPlate(P); } }));
    document.querySelectorAll('input[name=bl]').forEach(r => r.checked = r.value === P.opt.baseline);
    $('#bs').value = P.opt.bStart; $('#be').value = P.opt.bEnd; $('#bs').disabled = $('#be').disabled = P.opt.baseline !== 'fixed';
  }
  document.querySelectorAll('input[name=thm]').forEach(r => r.addEventListener('change', () => { const P = cur(); P.opt.thMode = r.value; recompute(P); renderPlate(P); }));
  $('#th').addEventListener('change', e => { const P = cur(), v = parseFloat(e.target.value); if (v > 0) { P.opt.threshold = v; recompute(P); renderPlate(P); } });
  $('#auto').addEventListener('click', () => { const P = cur(); P.opt.threshold = QPCR.autoThreshold(P.data.wells, P.opt).value; P.an.targets.forEach(t => P.opt.thByT[t] = QPCR.autoThreshold(P.data.wells, P.opt, t).value); recompute(P); renderPlate(P); });
  document.querySelectorAll('input[name=bl]').forEach(r => r.addEventListener('change', () => { const P = cur(); P.opt.baseline = r.value; $('#auto').click(); }));
  ['#bs', '#be'].forEach(id => $(id).addEventListener('change', () => { const P = cur(); P.opt.bStart = Math.max(1, +$('#bs').value); P.opt.bEnd = Math.max(P.opt.bStart + 1, +$('#be').value); recompute(P); renderPlate(P); }));

  // ---------- layout with selection ----------
  function layoutSVG(P, forExport) {
    const ink = cv('--ink'), muted = cv('--muted'), bg = cv('--bg'), sel = cv('--accent');
    const R = P.data.nrow, C = P.data.ncol, cell = C > 12 ? 30 : 56, pad = 34;
    const W = pad + C * cell + 8, H = pad + R * cell + 8;
    const byPos = {}; P.an.wells.forEach(w => (byPos[w.pos] = byPos[w.pos] || []).push(w));
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${forExport ? W * 2 : W}" ${forExport ? `height="${H * 2}"` : ''} font-family="-apple-system,Segoe UI,Roboto,Arial,sans-serif" role="img" aria-label="Plate layout">`;
    if (forExport) s += `<rect width="${W}" height="${H}" fill="${bg}"/>`;
    for (let j = 0; j < C; j++) s += `<text class="hdr" data-col="${j + 1}" x="${pad + j * cell + cell / 2}" y="20" text-anchor="middle" font-size="12" font-weight="600" fill="${ink}" style="cursor:pointer">${j + 1}</text>`;
    for (let i = 0; i < R; i++) s += `<text class="hdr" data-row="${ROWL[i]}" x="12" y="${pad + i * cell + cell / 2 + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${ink}" style="cursor:pointer">${ROWL[i]}</text>`;
    for (let i = 0; i < R; i++) for (let j = 1; j <= C; j++) {
      const pos = ROWL[i] + j, ws = byPos[pos], cx = pad + (j - 1) * cell + cell / 2, cy = pad + i * cell + cell / 2, r = cell / 2 - 3;
      if (!ws) { s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${muted}" stroke-opacity=".35"/>`; continue; }
      const w = ws[0], col = tColor(P, w.target), ntc = QPCR.isNTC(w), exc = ws.every(x => x.excluded), flag = ws.some(x => x.flags.length), isSel = P.sel.has(pos);
      const tip = ws.map(x => `${x.pos} · ${x.sample} · ${x.target} · Ct ${x.ct == null ? 'Undetermined' : x.ct.toFixed(2)}${x.flags.length ? ' · ' + x.flags.join('; ') : ''}${x.excluded ? ' · excluded' : ''}`).join('\n');
      s += `<g class="well" data-pos="${pos}" style="cursor:pointer"><title>${esc(tip)}</title>`;
      if (isSel && !forExport) s += `<rect x="${cx - cell / 2 + 1}" y="${cy - cell / 2 + 1}" width="${cell - 2}" height="${cell - 2}" rx="6" fill="${sel}" fill-opacity=".12" stroke="${sel}" stroke-width="2"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${exc ? muted : ntc ? bg : col}" fill-opacity="${exc ? .15 : ntc ? 1 : .18}" stroke="${exc ? muted : col}" stroke-width="1.5" ${ntc ? 'stroke-dasharray="4 3"' : ''}/>`;
      if (flag && !exc) s += `<circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="#D08700" stroke-width="2"/>`;
      if (exc) s += `<line x1="${cx - r * .7}" y1="${cy + r * .7}" x2="${cx + r * .7}" y2="${cy - r * .7}" stroke="${muted}" stroke-width="1.5"/>`;
      if (C <= 12) {
        const cut = t => t.length > 8 ? t.slice(0, 7) + '…' : t;
        let lines = [w.sample];
        if (w.sample.length > 8) { const k = w.sample.search(/[-_ ]/); lines = k > 0 && k < w.sample.length - 1 ? [w.sample.slice(0, k), w.sample.slice(k + 1)] : [w.sample.slice(0, 8), w.sample.slice(8)]; }
        lines = lines.map(cut); const y0 = lines.length > 1 ? cy - 9 : cy - 2;
        lines.forEach((t, k) => { s += `<text x="${cx}" y="${y0 + k * 10}" text-anchor="middle" font-size="9" fill="${ink}" pointer-events="none">${esc(t)}</text>`; });
        s += `<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="8" fill="${muted}" pointer-events="none">${esc(w.ct == null ? 'Undet.' : w.ct.toFixed(1))}</text>`;
      }
      s += '</g>';
    }
    return s + '</svg>';
  }
  function renderLayout(P) {
    $('#layout').innerHTML = layoutSVG(P, false);
    const toggle = list => { const all = list.every(p => P.sel.has(p)); list.forEach(p => all ? P.sel.delete(p) : P.sel.add(p)); renderLayout(P); renderChart(P); };
    const present = new Set(P.an.wells.map(w => w.pos));
    $('#layout').querySelectorAll('.well').forEach(g => g.addEventListener('click', () => toggle([g.dataset.pos])));
    $('#layout').querySelectorAll('[data-row]').forEach(t => t.addEventListener('click', () => toggle([...present].filter(p => p[0] === t.dataset.row))));
    $('#layout').querySelectorAll('[data-col]').forEach(t => t.addEventListener('click', () => toggle([...present].filter(p => p.slice(1) === t.dataset.col))));
    $('#selinfo').textContent = P.sel.size ? `${P.sel.size} well${P.sel.size > 1 ? 's' : ''} selected — plots show only these.` : 'Click wells, a row letter or a column number to select; plots then show only the selection.';
    $('#layoutlegend').innerHTML = P.an.targets.map(t => `<span><i class="dot" style="--c:${tColor(P, t)}"></i>${esc(t)}</span>`).join('') +
      `<span><i class="dot ntc"></i>NTC / water</span><span><i class="dot flag"></i>QC flag</span><span><i class="dot exc"></i>Excluded</span><span class="hint">Number = Ct at the current threshold.</span>`;
  }
  $('#selclear').addEventListener('click', () => { const P = cur(); P.sel.clear(); renderLayout(P); renderChart(P); });
  $('#selexc').addEventListener('click', () => { const P = cur(); P.an.wells.filter(w => P.sel.has(w.pos)).forEach(w => P.opt.excluded[key(w)] = true); recompute(P); renderPlate(P); });
  $('#selinc').addEventListener('click', () => { const P = cur(); P.an.wells.filter(w => P.sel.has(w.pos)).forEach(w => delete P.opt.excluded[key(w)]); recompute(P); renderPlate(P); });

  // ---------- filters + main chart ----------
  function renderFilters(P) {
    const mk = (items, set, colorFn, id) => items.map(x => `<label><input type="checkbox" data-${id}="${esc(x)}" ${set.has(x) ? 'checked' : ''}><i class="dot" style="--c:${colorFn(x)}"></i>${esc(x)}</label>`).join('');
    $('#tfilter').innerHTML = mk(P.an.targets, P.view.targets, t => tColor(P, t), 't');
    $('#sfilter').innerHTML = mk(P.an.samples, P.view.samples, s => sColor(P, s), 's');
    $('#tfilter').querySelectorAll('input').forEach(i => i.addEventListener('change', () => { i.checked ? P.view.targets.add(i.dataset.t) : P.view.targets.delete(i.dataset.t); renderChart(P); }));
    $('#sfilter').querySelectorAll('input').forEach(i => i.addEventListener('change', () => { i.checked ? P.view.samples.add(i.dataset.s) : P.view.samples.delete(i.dataset.s); renderChart(P); }));
    document.querySelectorAll('[data-scale]').forEach(b => b.setAttribute('aria-pressed', b.dataset.scale === P.view.scale));
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === P.view.colorBy));
    document.querySelectorAll('[data-plot]').forEach(b => b.setAttribute('aria-pressed', b.dataset.plot === P.view.plot));
    $('#showexc').checked = P.view.showExcluded;
  }
  document.querySelectorAll('[data-scale]').forEach(b => b.addEventListener('click', () => { const P = cur(); P.view.scale = b.dataset.scale; renderFilters(P); renderChart(P); }));
  document.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => { const P = cur(); P.view.colorBy = b.dataset.color; renderFilters(P); renderChart(P); }));
  document.querySelectorAll('[data-plot]').forEach(b => b.addEventListener('click', () => { const P = cur(); P.view.plot = b.dataset.plot; renderFilters(P); renderChart(P); }));
  $('#sall').addEventListener('click', () => { const P = cur(); P.view.samples = new Set(P.an.samples); renderFilters(P); renderChart(P); });
  $('#snone').addEventListener('click', () => { const P = cur(); P.view.samples = new Set(); renderFilters(P); renderChart(P); });
  $('#showexc').addEventListener('change', e => { const P = cur(); P.view.showExcluded = e.target.checked; renderChart(P); });

  function axisY(scale, ys, floor, title) {
    const muted = cv('--muted'), line = cv('--line');
    const ymax = Math.max(...ys);
    if (scale === 'log') {
      const lmin = Math.pow(10, Math.floor(Math.log10(Math.max(floor, ymax * 1e-4)))), lmax = Math.pow(10, Math.ceil(Math.log10(ymax)));
      return { type: 'logarithmic', min: lmin, max: lmax, title: { display: true, text: title, color: muted }, ticks: { color: muted, callback: v => { const e = Math.round(Math.log10(v)); if (Math.abs(Math.log10(v) - e) > 1e-3) return ''; return e >= -3 && e <= 4 ? String(+Math.pow(10, e).toFixed(Math.max(0, -e))) : '1e' + e; } }, grid: { color: line } };
    }
    return { type: 'linear', suggestedMin: 0, title: { display: true, text: title, color: muted }, ticks: { color: muted }, grid: { color: line } };
  }
  function lineChart(id, X, ds, y, hovId) {
    const muted = cv('--muted');
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($('#' + id), { type: 'line', data: { labels: X, datasets: ds }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', intersect: false },
      onHover: (e, a) => { if (a.length) { const d = charts[id].data.datasets[a[0].datasetIndex]; if (d.meta) $('#' + hovId).textContent = d.meta; } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { ticks: { color: muted }, grid: { display: false }, title: { display: true, text: 'Cycle', color: muted } }, y } } });
  }
  function visibleWells(P) {
    return P.an.wells.filter(w => P.view.samples.has(w.sample) && P.view.targets.has(w.target) && (!w.excluded || P.view.showExcluded) && (!P.sel.size || P.sel.has(w.pos)));
  }
  function renderChart(P) {
    const muted = cv('--muted'); const ws = visibleWells(P);
    const n = Math.max(...P.an.wells.map(w => w.y.length)); const X = Array.from({ length: n }, (_, i) => i + 1);
    const meta = w => `${w.pos} · ${w.sample} · ${w.target} · Ct ${w.ct == null ? 'Undetermined' : w.ct.toFixed(2)}${w.flags.length ? ' · ' + w.flags.join('; ') : ''}${w.excluded ? ' · excluded' : ''}`;
    const colOf = w => w.excluded ? muted : P.view.colorBy === 'target' ? tColor(P, w.target) : sColor(P, w.sample);
    const ds = []; let ys = [], title = 'ΔRn', floor = 1e-3;
    $('#mcnote').hidden = true;
    if (P.view.plot === 'mc') {
      const has = ws.filter(w => w.mc);
      if (!has.length) { $('#mcnote').hidden = false; }
      has.forEach(w => Object.entries(w.mc).forEach(([dye, arr]) => {
        const rox = /ROX/i.test(dye);
        ds.push({ data: arr, borderColor: colOf(w), borderWidth: rox ? 1.2 : 1.5, borderDash: rox ? [5, 3] : [], pointRadius: 0, tension: .2, meta: `${meta(w)} · ${dye} raw signal` });
        ys = ys.concat(arr.filter(v => v != null && v > 0));
      }));
      title = 'Fluorescence (solid FAM, dashed ROX)'; floor = 1;
    } else {
      const field = P.view.plot === 'rn' ? 'rn' : 'y';
      ws.forEach(w => { const d = w[field]; ds.push({ data: P.view.scale === 'log' ? d.map(v => v != null && v > 0 ? v : null) : d, borderColor: colOf(w), borderWidth: 1.5, borderDash: w.excluded ? [2, 3] : [], pointRadius: 0, tension: .2, meta: meta(w) }); ys = ys.concat(d.filter(v => v != null)); });
      if (field === 'y') {
        const ths = P.opt.thMode === 'target' ? P.an.targets.filter(t => P.view.targets.has(t)).map(t => [t, QPCR.thresholdFor(P.opt, t)]) : [['all targets', P.opt.threshold]];
        ths.forEach(([t, v]) => ds.push({ data: X.map(() => v), borderColor: t === 'all targets' ? muted : tColor(P, t), borderDash: [6, 4], borderWidth: 1, pointRadius: 0, meta: `Threshold (${t}) ${v}` }));
        floor = Math.min(...ths.map(x => x[1])) / 100;
      } else { title = 'Rn'; floor = Math.max(1e-6, Math.min(...ys.filter(v => v > 0)) / 2); }
    }
    if (!ys.length) ys = [1];
    lineChart('chart', X, ds, axisY(P.view.plot === 'mc' ? 'linear' : P.view.scale, ys.filter(v => v > 0).length ? ys.filter(v => v > 0) : [1], floor, title), 'hov');
  }

  // ---------- QC ----------
  function renderQC(P) {
    const fl = P.an.wells.filter(w => w.flags.length); const hs = P.an.summary.filter(r => r.highsd);
    $('#qccount').textContent = fl.length ? `${fl.length} well${fl.length > 1 ? 's' : ''} flagged` : 'No wells flagged';
    $('#qc').innerHTML = (fl.length ? `<table><thead><tr><th>Exclude</th><th>Well</th><th>Sample</th><th>Target</th><th>Ct</th><th>Issue</th></tr></thead><tbody>${fl.map(w =>
      `<tr><td><input type="checkbox" data-k="${esc(key(w))}" ${w.excluded ? 'checked' : ''} aria-label="Exclude ${esc(w.pos)}"></td><td>${w.pos}</td><td>${esc(w.sample)}</td><td>${esc(w.target)}</td><td>${w.ct == null ? 'Undet.' : w.ct.toFixed(2)}</td><td>${esc(w.flags.join('; '))}</td></tr>`).join('')}</tbody></table>` : '') +
      (hs.length ? `<p class="hint">Replicate SD above 0.5 cycles (HIGHSD): ${hs.map(r => esc(r.sample + ' / ' + r.target) + ' (' + r.sd.toFixed(2) + ')').join(', ')}</p>` : '');
    $('#qc').querySelectorAll('input').forEach(i => i.addEventListener('change', () => { if (i.checked) P.opt.excluded[i.dataset.k] = true; else delete P.opt.excluded[i.dataset.k]; recompute(P); renderPlate(P); }));
  }
  $('#excall').addEventListener('click', () => { const P = cur(); P.an.wells.filter(w => w.flags.length && !QPCR.isNTC(w) && w.amp).forEach(w => P.opt.excluded[key(w)] = true); recompute(P); renderPlate(P); });
  $('#exclear').addEventListener('click', () => { const P = cur(); P.opt.excluded = {}; recompute(P); renderPlate(P); });

  // ---------- ΔCt + bar chart ----------
  const deltaRows = P => QPCR.deltaTable(P.an, P.delta.target, P.delta.ref, P.delta.controls);
  function renderDelta(P) {
    const D = P.delta; const opts = sel => P.an.targets.map(t => `<option ${t === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
    $('#dtarget').innerHTML = opts(D.target); $('#dref').innerHTML = opts(D.ref);
    const rows = deltaRows(P); const names = rows.map(r => r.sample);
    $('#dall').innerHTML = `<option value="">Set control for all…</option><option value="__none">None</option>` + names.map(n => `<option>${esc(n)}</option>`).join('');
    $('#delta').innerHTML = rows.length ? `<table><thead><tr><th>Sample</th><th>Ct ${esc(D.target)}</th><th>Ct ${esc(D.ref)}</th><th>ΔCt</th><th>Matched control</th><th>ΔΔCt</th><th>Fold vs control</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${esc(r.sample)}</td><td>${f2(r.ctT)}</td><td>${f2(r.ctR)}</td><td class="${r.d != null && r.d > 0 ? 'pos' : ''}">${sgn(r.d)}${r.dsd != null ? ` <span class="sd">± ${r.dsd.toFixed(2)}</span>` : ''}</td>
       <td><select data-s="${esc(r.sample)}" aria-label="Control for ${esc(r.sample)}"><option value="">—</option>${names.filter(n => n !== r.sample).map(n => `<option ${n === r.control ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></td>
       <td>${sgn(r.ddct)}</td><td>${r.fold == null ? '—' : r.fold.toFixed(2) + '×'}</td></tr>`).join('')}</tbody></table>`
      : `<p class="hint">No sample has both ${esc(D.target)} and ${esc(D.ref)} wells (sample names must match across targets).</p>`;
    $('#delta').querySelectorAll('select').forEach(s => s.addEventListener('change', () => { D.controls[s.dataset.s] = s.value; renderDelta(P); }));
    $('#dformula').textContent = `ΔCt = Ct(${D.ref}) − Ct(${D.target}); positive means more ${D.target} than ${D.ref}. ΔΔCt = ΔCt(sample) − ΔCt(control); fold = 2^ΔΔCt.`;
    document.querySelectorAll('[data-dm]').forEach(b => b.setAttribute('aria-pressed', b.dataset.dm === D.metric));
    const useFold = D.metric === 'fold';
    const bars = rows.filter(r => useFold ? r.fold != null : r.d != null);
    barChart('dchart', bars.map(r => r.sample), bars.map(r => useFold ? r.fold : r.d), bars.map(r => useFold ? null : r.dsd), bars.map(r => r.d != null && r.d > 0 ? tColor(P, D.target) : cv('--muted')),
      useFold ? 'Fold vs matched control (2^ΔΔCt)' : `ΔCt = Ct(${D.ref}) − Ct(${D.target})`, useFold ? 1 : 0);
    $('#dchartnote').textContent = useFold && !bars.length ? 'Pick matched controls in the table to plot fold changes.' : '';
  }
  $('#dtarget').addEventListener('change', e => { const P = cur(); P.delta.target = e.target.value; renderDelta(P); });
  $('#dref').addEventListener('change', e => { const P = cur(); P.delta.ref = e.target.value; renderDelta(P); });
  $('#dall').addEventListener('change', e => { const P = cur(), v = e.target.value; if (!v) return; deltaRows(P).forEach(r => P.delta.controls[r.sample] = v === '__none' || v === r.sample ? '' : v); renderDelta(P); });
  document.querySelectorAll('[data-dm]').forEach(b => b.addEventListener('click', () => { const P = cur(); P.delta.metric = b.dataset.dm; renderDelta(P); }));

  const errorBars = { id: 'errorBars', afterDatasetsDraw(c) { const ds = c.data.datasets[0]; if (!ds || !ds.errors) return; const m = c.getDatasetMeta(0), y = c.scales.y, g = c.ctx; g.save(); g.strokeStyle = cv('--ink'); g.lineWidth = 1.2;
    m.data.forEach((bar, i) => { const e = ds.errors[i], v = ds.data[i]; if (e == null || v == null) return; const t = y.getPixelForValue(v + e), b = y.getPixelForValue(v - e); g.beginPath(); g.moveTo(bar.x, t); g.lineTo(bar.x, b); g.moveTo(bar.x - 5, t); g.lineTo(bar.x + 5, t); g.moveTo(bar.x - 5, b); g.lineTo(bar.x + 5, b); g.stroke(); }); g.restore(); } };
  const refLine = { id: 'refLine', afterDraw(c) { const v = c.options.plugins.refLine && c.options.plugins.refLine.value; if (v == null) return; const y = c.scales.y.getPixelForValue(v), g = c.ctx; g.save(); g.strokeStyle = cv('--ink'); g.setLineDash([4, 3]); g.beginPath(); g.moveTo(c.chartArea.left, y); g.lineTo(c.chartArea.right, y); g.stroke(); g.restore(); } };
  function barChart(id, labels, data, errors, colors, title, ref) {
    const muted = cv('--muted'), line = cv('--line');
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($('#' + id), { type: 'bar', data: { labels, datasets: [{ data, errors, backgroundColor: colors.map(c => c + 'CC'), borderColor: colors, borderWidth: 1 }] }, plugins: [errorBars, refLine],
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, refLine: { value: ref }, tooltip: { callbacks: { label: c => `${c.parsed.y.toFixed(2)}${errors && errors[c.dataIndex] != null ? ' ± ' + errors[c.dataIndex].toFixed(2) : ''}` } } },
        scales: { x: { ticks: { color: muted, autoSkip: false, maxRotation: 60, minRotation: 30 }, grid: { display: false } }, y: { title: { display: true, text: title, color: muted }, ticks: { color: muted }, grid: { color: line } } } } });
  }

  function renderSummary(P) {
    $('#summary').innerHTML = `<table><thead><tr><th>Sample</th><th>Target</th><th>Wells used</th><th>Amplified</th><th>Mean Ct</th><th>SD</th></tr></thead><tbody>${P.an.summary.map(r =>
      `<tr><td>${esc(r.sample)}</td><td><i class="dot" style="--c:${tColor(P, r.target)}"></i>${esc(r.target)}</td><td>${r.n}${r.excluded ? ` (${r.excluded} excl.)` : ''}</td><td>${r.nAmp}/${r.n}</td><td>${f2(r.mean)}</td><td class="${r.sd != null && r.sd > 0.3 ? 'bad' : ''}">${f2(r.sd)}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderWells(P) {
    $('#wells').innerHTML = `<table><thead><tr><th>Well</th><th>Sample</th><th>Target</th><th>Threshold</th><th>Ct (this view)</th><th>Ct (instrument)</th><th>Excluded</th><th>Flags</th></tr></thead><tbody>${P.an.wells.map(w =>
      `<tr><td>${w.pos}</td><td>${esc(w.sample)}</td><td>${esc(w.target)}</td><td>${+w.th.toPrecision(3)}</td><td>${w.ct == null ? 'Undet.' : w.ct.toFixed(2)}</td><td>${w.ctInst == null ? 'Undet.' : w.ctInst.toFixed(2)}</td><td>${w.excluded ? 'yes' : ''}</td><td>${esc(w.flags.join('; '))}</td></tr>`).join('')}</tbody></table>`;
  }

  // =================== compare view ===================
  const guessCal = P => P.an.samples.find(s => /^pc\b|positive|6a-3/i.test(s)) || '';
  const calOf = P => { if (!(P.id in cmp.cal)) cmp.cal[P.id] = guessCal(P); return cmp.cal[P.id]; };
  const pcRow = P => { const n = calOf(P); return n ? deltaRows(P).find(r => r.sample === n) : null; };
  function renderCompare() {
    // run QC
    $('#runqc').innerHTML = `<table><thead><tr><th>Plate</th><th>Run ended</th><th>Method</th><th>Passive ref.</th><th>Threshold</th><th>Flagged wells</th><th>NTC amplified</th><th>Calibrator</th><th>Calibrator ΔCt</th></tr></thead><tbody>${plates.map(P => {
      const pc = pcRow(P); const cn = calOf(P); const opts = deltaRows(P).map(r => r.sample); const ntcAmp = P.an.wells.filter(w => QPCR.isNTC(w) && w.ct != null && w.ct < 35).length;
      const th = P.opt.thMode === 'target' ? P.an.targets.map(t => `${t} ${+QPCR.thresholdFor(P.opt, t).toPrecision(2)}`).join(', ') : `${+P.opt.threshold.toPrecision(3)} (shared)`;
      const m = P.data.info && P.data.info.protocol ? QPCR.protocolText(P.data.info.protocol) : '—';
      return `<tr><td><i class="dot" style="--c:${pColor(P)}"></i>${esc(P.name)}</td><td>${esc(runText(P) || '—')}</td><td class="small">${esc(m)}</td><td>${esc(P.data.passive || 'none')}</td><td class="small">${esc(th)}</td><td>${P.an.wells.filter(w => w.flags.length).length}</td><td class="${ntcAmp ? 'bad' : ''}">${ntcAmp}</td><td><select data-cal="${P.id}" aria-label="Calibrator for ${esc(P.name)}"><option value="">None</option>${opts.map(o => `<option ${o === cn ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td><td>${pc ? sgn(pc.d) + (pc.dsd != null ? ` <span class="sd">± ${pc.dsd.toFixed(2)}</span>` : '') : '—'}</td></tr>`; }).join('')}</tbody></table>`;
    $('#runqc').querySelectorAll('[data-cal]').forEach(el => el.addEventListener('change', () => { cmp.cal[+el.dataset.cal] = el.value; renderCompare(); }));
    // combined table
    const rows = []; plates.forEach(P => { const pc = pcRow(P); deltaRows(P).forEach(r => rows.push({ P, ...r, vsCal: pc && r.d != null && pc.d != null ? r.d - pc.d : null })); });
    $('#ctable').innerHTML = rows.length ? `<table><thead><tr><th>Plate</th><th>Sample</th><th>Target / baseline</th><th>ΔCt</th><th>Control</th><th>ΔΔCt</th><th>Fold vs control</th><th>ΔCt − calibrator ΔCt</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td><i class="dot" style="--c:${pColor(r.P)}"></i>${esc(r.P.name)}</td><td>${esc(r.sample)}</td><td class="small">${esc(r.P.delta.target)} / ${esc(r.P.delta.ref)}</td><td class="${r.d != null && r.d > 0 ? 'pos' : ''}">${sgn(r.d)}${r.dsd != null ? ` <span class="sd">± ${r.dsd.toFixed(2)}</span>` : ''}</td><td>${esc(r.control || '—')}</td><td>${sgn(r.ddct)}</td><td>${r.fold == null ? '—' : r.fold.toFixed(2) + '×'}</td><td>${sgn(r.vsCal)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No ΔCt rows yet.</p>';
    document.querySelectorAll('[data-cm]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cm === cmp.metric));
    const pick = r => cmp.metric === 'fold' ? r.fold : cmp.metric === 'cal' ? r.vsCal : r.d;
    const bars = rows.filter(r => pick(r) != null);
    barChart('cchart', bars.map(r => `${r.P.name} · ${r.sample}`), bars.map(pick), bars.map(r => cmp.metric === 'dct' ? r.dsd : null), bars.map(r => pColor(r.P)),
      cmp.metric === 'fold' ? 'Fold vs matched control (each plate)' : cmp.metric === 'cal' ? 'ΔCt minus calibrator ΔCt on the same plate' : 'ΔCt (each plate\'s target / baseline)', cmp.metric === 'fold' ? 1 : 0);
    $('#cchartnote').textContent = !bars.length ? (cmp.metric === 'fold' ? 'Set matched controls on each plate\'s tab to compare fold changes.' : cmp.metric === 'cal' ? 'Choose a calibrator sample present on each plate.' : '') : '';
    renderOverlay();
  }
  document.querySelectorAll('[data-cm]').forEach(b => b.addEventListener('click', () => { cmp.metric = b.dataset.cm; renderCompare(); }));

  function renderOverlay() {
    const tg = new Set(); plates.forEach(P => P.an.targets.forEach(t => tg.add(t)));
    if (!cmp.otargets.size) tg.forEach(t => cmp.otargets.add(t));
    $('#otargets').innerHTML = [...tg].map((t, i) => `<label><input type="checkbox" data-ot="${esc(t)}" ${cmp.otargets.has(t) ? 'checked' : ''}><span class="ls ls${i % 3}"></span>${esc(t)}</label>`).join('');
    $('#otargets').querySelectorAll('input').forEach(i => i.addEventListener('change', () => { i.checked ? cmp.otargets.add(i.dataset.ot) : cmp.otargets.delete(i.dataset.ot); renderOverlay(); }));
    $('#olist').innerHTML = plates.map(P => `<div class="ogroup"><b><i class="dot" style="--c:${pColor(P)}"></i>${esc(P.name)}</b>${P.an.samples.map(s => { const k = P.id + '|' + s; return `<label><input type="checkbox" data-ok="${esc(k)}" ${cmp.overlay.has(k) ? 'checked' : ''}>${esc(s)}</label>`; }).join('')}</div>`).join('');
    $('#olist').querySelectorAll('input').forEach(i => i.addEventListener('change', () => { i.checked ? cmp.overlay.add(i.dataset.ok) : cmp.overlay.delete(i.dataset.ok); renderOverlay(); }));
    const tgl = [...tg]; const dash = t => [[], [6, 3], [2, 3]][tgl.indexOf(t) % 3];
    const ds = []; let ys = []; let n = 40;
    plates.forEach(P => P.an.wells.forEach(w => {
      if (!cmp.overlay.has(P.id + '|' + w.sample) || !cmp.otargets.has(w.target) || w.excluded) return;
      n = Math.max(n, w.y.length); ds.push({ data: w.y.map(v => v != null && v > 0 ? v : null), borderColor: pColor(P), borderDash: dash(w.target), borderWidth: 1.5, pointRadius: 0, tension: .2, meta: `${P.name} · ${w.pos} · ${w.sample} · ${w.target} · Ct ${w.ct == null ? 'Undetermined' : w.ct.toFixed(2)}` });
      ys = ys.concat(w.y.filter(v => v != null && v > 0));
    }));
    const X = Array.from({ length: n }, (_, i) => i + 1);
    lineChart('ochart', X, ds, axisY('log', ys.length ? ys : [1], 1e-3, 'ΔRn (each plate\'s own baseline)'), 'ohov');
    $('#ohint').textContent = ds.length ? '' : 'Tick samples above to overlay their curves. Color = plate, line style = target.';
  }

  // =================== export ===================
  function dl(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = rows => new Blob(['\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
  const fx = (v, d = 3) => v == null || !Number.isFinite(v) ? '' : v.toFixed(d);
  const thDesc = P => P.opt.thMode === 'target' ? 'per target ' + P.an.targets.map(t => `${t}=${QPCR.thresholdFor(P.opt, t)}`).join(' ') : 'shared ' + P.opt.threshold;
  const settingsLine = P => [`# file ${P.file}; threshold ${thDesc(P)}; baseline ${P.opt.baseline === 'fixed' ? `cycles ${P.opt.bStart}-${P.opt.bEnd}` : 'instrument'}`];
  $('#xwells').addEventListener('click', () => { const P = cur(); dl(P.name + '_wells.csv', csv([settingsLine(P), ['Well', 'Sample', 'Target', 'Threshold', 'Ct', 'Ct_instrument', 'Excluded', 'Flags'], ...P.an.wells.map(w => [w.pos, w.sample, w.target, w.th, w.ct == null ? 'Undetermined' : fx(w.ct), w.ctInst == null ? 'Undetermined' : fx(w.ctInst), w.excluded ? 'yes' : '', w.flags.join('; ')])])); });
  $('#xsum').addEventListener('click', () => { const P = cur(); dl(P.name + '_summary.csv', csv([settingsLine(P), ['Sample', 'Target', 'Wells used', 'Amplified', 'Mean Ct', 'SD'], ...P.an.summary.map(r => [r.sample, r.target, r.n, r.nAmp, fx(r.mean), fx(r.sd)])])); });
  $('#xdelta').addEventListener('click', () => { const P = cur(); dl(P.name + '_deltaCt.csv', csv([settingsLine(P), ['Sample', 'Ct ' + P.delta.target, 'Ct ' + P.delta.ref, 'dCt', 'dCt SD', 'Control', 'ddCt', 'Fold'], ...deltaRows(P).map(r => [r.sample, fx(r.ctT), fx(r.ctR), fx(r.d), fx(r.dsd), r.control, fx(r.ddct), fx(r.fold)])])); });
  function canvasPNG(id, name) { const src = $('#' + id); const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const g = c.getContext('2d'); g.fillStyle = cv('--bg'); g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0); c.toBlob(b => dl(name, b)); }
  $('#xplot').addEventListener('click', () => { const P = cur(); canvasPNG('chart', `${P.name}_${P.view.plot === 'mc' ? 'multicomponent' : P.view.plot === 'rn' ? 'Rn' : 'curves'}.png`); });
  $('#xbar').addEventListener('click', () => { const P = cur(); canvasPNG('dchart', P.name + '_deltaCt_chart.png'); });
  $('#xlayout').addEventListener('click', () => {
    const P = cur(); const svg = layoutSVG(P, true); const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(url); c.toBlob(b => dl(P.name + '_layout.png', b)); }; img.src = url;
  });
  $('#xcmp').addEventListener('click', () => {
    const rows = [['Plate', 'Sample', 'Target', 'Baseline', 'dCt', 'dCt SD', 'Control', 'ddCt', 'Fold', 'Calibrator', 'dCt minus calibrator dCt', 'Threshold', 'Baseline method']];
    plates.forEach(P => { const pc = pcRow(P); deltaRows(P).forEach(r => rows.push([P.name, r.sample, P.delta.target, P.delta.ref, fx(r.d), fx(r.dsd), r.control, fx(r.ddct), fx(r.fold), calOf(P), pc && r.d != null && pc.d != null ? fx(r.d - pc.d) : '', thDesc(P), P.opt.baseline === 'fixed' ? `cycles ${P.opt.bStart}-${P.opt.bEnd}` : 'instrument'])); });
    dl('plates_comparison_deltaCt.csv', csv(rows));
  });
  $('#xcchart').addEventListener('click', () => canvasPNG('cchart', 'plates_comparison_chart.png'));
  $('#xochart').addEventListener('click', () => canvasPNG('ochart', 'plates_overlay_curves.png'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (plates.length) render(); });
})();
