// qPCR Reader core: parse QuantStudio .eds / exported .xls(x)/.ods, compute Cts, QC, summaries.
(function (root) {
  const ROWS = 'ABCDEFGHIJKLMNOP';

  function posFromIndex(i, ncol) { return ROWS[Math.floor(i / ncol)] + (i % ncol + 1); }
  function splitPos(p) { const m = /^([A-P])(\d+)$/.exec(p); return m ? { row: ROWS.indexOf(m[1]), col: +m[2] } : null; }
  function num(x) { const v = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(v) ? v : null; }

  // ---------- .eds (zip) ----------
  async function parseEDS(buf, JSZip) {
    const zip = await JSZip.loadAsync(buf);
    const fname = Object.keys(zip.files).find(n => /analysis_result\.txt$/i.test(n));
    if (!fname) throw new Error('This .eds file has no analysis_result.txt. Open it in QuantStudio, analyze, save, then try again — or export the results as .xls.');
    const text = await zip.file(fname).async('string');
    const recs = []; let cur = null;
    for (const line of text.split(/\r?\n/)) {
      const c = line.split('\t');
      if (/^\d+$/.test(c[0]) && c.length >= 5) {
        cur = { idx: +c[0], sample: (c[1] || '').trim(), target: (c[2] || '').trim(), task: (c[3] || '').trim(), ctInst: num(c[4]) };
        recs.push(cur);
      } else if (cur && c[0] === 'Rn values') cur.rn = c.slice(1).filter(x => x !== '').map(Number);
      else if (cur && c[0] === 'Delta Rn values') cur.drn = c.slice(1).filter(x => x !== '').map(Number);
    }
    const maxIdx = Math.max(...recs.map(r => r.idx));
    const ncol = maxIdx >= 96 ? 24 : 12, nrow = maxIdx >= 96 ? 16 : 8;
    const info = {};
    const find = re => Object.keys(zip.files).find(n => re.test(n));
    const exp = find(/experiment\.xml$/i);
    if (exp) {
      const x = await zip.file(exp).async('string');
      const nm = /<Name>([^<]*)<\/Name>/.exec(x); if (nm) info.name = nm[1].trim();
      const st = /<RunStartTime>(\d+)/.exec(x), en = /<RunEndTime>(\d+)/.exec(x);
      if (st && +st[1] > 0) info.start = new Date(+st[1]); if (en && +en[1] > 0) info.end = new Date(+en[1]);
      const ty = /<Id>[^<]*<\/Id>\s*<Name>([^<]*)<\/Name>/.exec(x); if (ty) info.type = ty[1].replace(/Cт/g, 'Ct').trim();
    }
    const tc = find(/tcprotocol\.xml$/i);
    if (tc) info.protocol = parseProtocol(await zip.file(tc).async('string'));
    const mcf = find(/multicomponentdata\.xml$/i); const mc = {};
    if (mcf) {
      const x = await zip.file(mcf).async('string'); const dyes = {};
      for (const m of x.matchAll(/<DyeData WellIndex="(\d+)">\s*<DyeList>\[([^\]]*)\]/g)) dyes[+m[1]] = m[2].split(',').map(d => d.trim());
      for (const m of x.matchAll(/<SignalData WellIndex="(\d+)">([\s\S]*?)<\/SignalData>/g)) {
        const arrs = [...m[2].matchAll(/<CycleData>\[([^\]]*)\]<\/CycleData>/g)].map(a => a[1].split(',').map(Number));
        const d = dyes[+m[1]] || []; const o = {}; d.forEach((name, i) => { if (arrs[i]) o[name] = arrs[i]; }); mc[+m[1]] = o;
      }
    }
    const wells = recs.filter(r => r.rn && r.rn.length && r.sample !== '' ).map(r => {
      const pos = posFromIndex(r.idx, ncol);
      return { pos, ...splitPos(pos), sample: r.sample, target: r.target, task: r.task, rn: r.rn, drn: r.drn || r.rn.map(() => 0), ctInst: r.ctInst, mc: mc[r.idx] || null };
    });
    const hasRox = wells.some(w => w.mc && w.mc.ROX);
    return { wells, nrow, ncol, source: 'eds', passive: hasRox ? 'ROX' : '', info };
  }

  function parseProtocol(x) {
    const p = { mode: (/<RunMode>([^<]*)/.exec(x) || [])[1] || '', volume: +((/<SampleVolume>([^<]*)/.exec(x) || [])[1] || 0), stages: [] };
    for (const st of x.matchAll(/<TCStage>([\s\S]*?)<\/TCStage>/g)) {
      const reps = +((/<NumOfRepetitions>(\d+)/.exec(st[1]) || [])[1] || 1);
      const steps = [...st[1].matchAll(/<TCStep\b[^>]*>([\s\S]*?)<\/TCStep>/g)].map(sp => ({ temp: +((/<Temperature>([^<]*)/.exec(sp[1]) || [])[1]), hold: +((/<HoldTime>([^<]*)/.exec(sp[1]) || [])[1]), collect: /<CollectionFlag>1</.test(sp[1]) }));
      p.stages.push({ reps, steps, flag: (/<StageFlag>([^<]*)/.exec(st[1]) || [])[1] || '' });
    }
    return p;
  }
  function fmtTime(s) { return s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '0:' + String(s).padStart(2, '0'); }
  function protocolText(p) {
    if (!p || !p.stages.length) return '';
    return p.stages.map(st => { const t = st.steps.map(s => `${s.temp} °C ${fmtTime(s.hold)}${s.collect ? ' ●' : ''}`).join(', '); return st.reps > 1 ? `${st.reps}× [${t}]` : t; }).join(' → ');
  }

  // ---------- exported spreadsheet ----------
  function sheetRows(XLSX, ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }); }
  function tableFrom(rows) {
    const h = rows.findIndex(r => r && r[0] === 'Well');
    if (h < 0) return null;
    const head = rows[h].map(x => (x == null ? '' : String(x).trim()));
    const meta = {};
    rows.slice(0, h).forEach(r => { if (r && r[0] != null && r[1] != null) meta[String(r[0]).trim()] = r[1]; });
    return { head, body: rows.slice(h + 1).filter(r => r && r.some(v => v != null)), meta };
  }
  function col(t, ...names) { for (const n of names) { const i = t.head.indexOf(n); if (i >= 0) return i; } return -1; }

  function parseSheet(buf, XLSX) {
    const wb = XLSX.read(buf, { type: 'array' });
    const get = n => wb.Sheets[wb.SheetNames.find(s => s.toLowerCase() === n.toLowerCase())];
    const amp = get('Amplification Data');
    if (!amp) throw new Error('No "Amplification Data" sheet found. In QuantStudio, export Results, Amplification Data and Sample Setup.');
    const A = tableFrom(sheetRows(XLSX, amp));
    const iW = col(A, 'Well Position'), iC = col(A, 'Cycle'), iT = col(A, 'Target Name'), iRn = col(A, 'Rn'), iD = col(A, 'Delta Rn');
    const map = new Map();
    for (const r of A.body) {
      const pos = String(r[iW] || '').trim(); if (!splitPos(pos)) continue;
      const key = pos + '|' + (r[iT] || '');
      if (!map.has(key)) map.set(key, { pos, target: String(r[iT] || '').trim(), rn: [], drn: [] });
      const w = map.get(key), cyc = +r[iC] - 1;
      w.rn[cyc] = num(r[iRn]); w.drn[cyc] = num(r[iD]);
    }
    const info = {};
    const ss = get('Sample Setup');
    if (ss) {
      const S = tableFrom(sheetRows(XLSX, ss));
      const jW = col(S, 'Well Position'), jS = col(S, 'Sample Name'), jT = col(S, 'Target Name'), jK = col(S, 'Task');
      for (const r of S.body) { const pos = String(r[jW] || '').trim(); if (splitPos(pos)) info[pos + '|' + (r[jT] || '')] = { sample: r[jS] == null ? '' : String(r[jS]).trim(), task: r[jK] || '' }; }
    }
    const res = get('Results'); const ctMap = {}; let passive = ''; let meta = {};
    if (res) {
      const R = tableFrom(sheetRows(XLSX, res));
      const kW = col(R, 'Well Position'), kT = col(R, 'Target Name'), kC = col(R, 'CT', 'Cт', 'Cq'), kS = col(R, 'Sample Name');
      for (const r of R.body) { const pos = String(r[kW] || '').trim(); if (!splitPos(pos)) continue; const k = pos + '|' + (r[kT] || ''); ctMap[k] = num(r[kC]); if (!info[k] && kS >= 0) info[k] = { sample: String(r[kS] || '').trim(), task: '' }; }
      passive = R.meta['Passive Reference'] || '';
      meta = R.meta;
    }
    // multicomponent (preferred) or raw filter data
    const mcByPos = {};
    const mcs = get('Multicomponent Data'), raw = get('Raw Data');
    if (mcs) {
      const M = tableFrom(sheetRows(XLSX, mcs)); const iw = col(M, 'Well Position'), ic = col(M, 'Cycle');
      const dyeCols = M.head.map((h, i) => [h, i]).filter(([h]) => /^(FAM|ROX|VIC|JUN|ABY|CY5|SYBR|NED|TAMRA)$/i.test(h));
      for (const r of M.body) { const pos = String(r[iw] || '').trim(); if (!splitPos(pos)) continue; const o = mcByPos[pos] = mcByPos[pos] || {}; dyeCols.forEach(([h, i]) => { (o[h.toUpperCase()] = o[h.toUpperCase()] || [])[+r[ic] - 1] = num(r[i]); }); }
    } else if (raw) {
      const M = tableFrom(sheetRows(XLSX, raw)); const iw = col(M, 'Well Position'), ic = col(M, 'Cycle'), i1 = col(M, 'x1-m1'), i4 = col(M, 'x4-m4');
      if (i1 >= 0) for (const r of M.body) { const pos = String(r[iw] || '').trim(); if (!splitPos(pos)) continue; const o = mcByPos[pos] = mcByPos[pos] || {}; (o.FAM = o.FAM || [])[+r[ic] - 1] = num(r[i1]); if (i4 >= 0) (o.ROX = o.ROX || [])[+r[ic] - 1] = num(r[i4]); }
    }
    const wells = [...map.entries()].map(([k, w]) => ({ ...w, ...splitPos(w.pos), sample: (info[k] || {}).sample || '', task: (info[k] || {}).task || '', ctInst: k in ctMap ? ctMap[k] : null, mc: mcByPos[w.pos] || null }))
      .filter(w => w.rn.length && w.sample !== '');
    const maxRow = Math.max(...wells.map(w => w.row)), maxCol = Math.max(...wells.map(w => w.col));
    return { wells, nrow: maxRow >= 8 || maxCol > 12 ? 16 : 8, ncol: maxRow >= 8 || maxCol > 12 ? 24 : 12, source: 'sheet', passive: String(passive || ''), info: { type: String(meta['Experiment Type'] || '').replace(/Cт/g, 'Ct'), endText: meta['Experiment Run End Time'] || '', name: meta['Experiment Name'] || '' } };
  }

  // ---------- analysis ----------
  function curve(w, opt) {
    if (opt.baseline === 'fixed') {
      const a = Math.max(1, opt.bStart) - 1, b = Math.min(w.rn.length, opt.bEnd);
      const seg = w.rn.slice(a, b).filter(v => v != null); const m = seg.reduce((s, v) => s + v, 0) / (seg.length || 1);
      return w.rn.map(v => v == null ? null : v - m);
    }
    return w.drn;
  }
  function ctOf(y, th) {
    const n = y.length; if (n < 2 || y[n - 1] == null || y[n - 1] < th) return null;
    let j = -1; for (let k = n - 2; k >= 0; k--) { if (y[k] != null && y[k] < th) { j = k; break; } }
    if (j < 0) return null;
    return (j + 1) + (th - y[j]) / (y[j + 1] - y[j]);
  }
  const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = a => a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1)) : null;
  const isNTC = w => /ntc/i.test(w.task) || /\b(ntc|water|h2o|nuclease)/i.test(w.sample);

  const bg = w => median(w.rn.slice(0, 5).filter(v => v != null && v > 0)) || 1;
  const amplified = (w, y) => {
    const mx = Math.max(...y.filter(v => v != null)); const seg = y.slice(2, 10).filter(v => v != null);
    const m = seg.reduce((a, b) => a + b, 0) / (seg.length || 1);
    const noise = Math.max(Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / (seg.length || 1)), 1e-6 * bg(w));
    return mx > 30 * noise && mx > 0.05 * bg(w);
  };
  function round2(t) { const p = Math.pow(10, Math.floor(Math.log10(t))); return +(Math.round(t / p * 10) / 10 * p).toPrecision(2); }
  function autoThreshold(wells, opt, target) {
    if (target !== undefined) wells = wells.filter(w => w.target === target);
    const amp = wells.map(w => [w, curve(w, opt)]).filter(([w, y]) => amplified(w, y)).map(([w, y]) => Math.max(...y.filter(v => v != null)));
    if (!amp.length) return { value: round2(0.1 * median(wells.map(bg))), anyAmp: false };
    return { value: round2(0.05 * median(amp)), anyAmp: true };
  }

  function thresholdFor(opt, t) { return opt.thMode === 'target' && opt.thByT && opt.thByT[t] > 0 ? opt.thByT[t] : opt.threshold; }
  function analyze(plate, opt) {
    const wells = plate.wells.map(w => {
      const y = curve(w, opt);
      const amp = amplified(w, y); const th = thresholdFor(opt, w.target);
      return { ...w, y, amp, th, ct: amp ? ctOf(y, th) : null, maxY: Math.max(...y.filter(v => v != null)), excluded: !!opt.excluded[w.pos + '|' + w.target] };
    });
    // QC flags
    const byT = {};
    wells.forEach(w => (byT[w.target] = byT[w.target] || []).push(w));
    for (const t in byT) {
      const ws = byT[t];
      const start = median(ws.map(w => w.rn[0]).filter(v => v != null && v > 0));
      const plat = median(ws.filter(w => w.ct != null && !isNTC(w)).map(w => w.maxY));
      ws.forEach(w => {
        w.flags = [];
        if (start && w.rn[0] != null && (w.rn[0] / start < 0.7 || w.rn[0] / start > 1.4)) w.flags.push(`Start Rn ${(w.rn[0] / start).toFixed(2)}× the ${t} median (bubble or volume?)`);
        if (plat && w.ct != null && w.ct < 30 && !isNTC(w) && w.maxY < 0.4 * plat) w.flags.push('Low plateau (DRNMIN)');
        if (isNTC(w) && w.ct != null && w.ct < 35) w.flags.push(`NTC amplified, Ct ${w.ct.toFixed(1)} (AMPNC)`);
        if (!isNTC(w) && !w.amp) w.flags.push('No amplification (NOAMP)');
      });
    }
    // ROX-based checks when multicomponent data exist
    const rox0 = median(wells.filter(w => w.mc && w.mc.ROX).map(w => w.mc.ROX[0]));
    if (rox0) wells.forEach(w => {
      if (!w.mc || !w.mc.ROX) return; const r = w.mc.ROX.filter(v => v != null); if (!r.length) return;
      const ratio = r[0] / rox0; const drift = (median(r.slice(-5)) - median(r.slice(0, 5))) / median(r.slice(0, 5));
      if (ratio < 0.7 || ratio > 1.3) w.flags.push(`ROX ${ratio.toFixed(2)}× plate median: volume or bubble (BADROX)`);
      if (Math.abs(drift) > 0.1) w.flags.push(`ROX changed ${(drift * 100).toFixed(0)}% during run: evaporation or seal (BADROX)`);
    });
    const groups = {};
    wells.forEach(w => { const k = w.sample + '|' + w.target; (groups[k] = groups[k] || []).push(w); });
    for (const k in groups) {
      const g = groups[k]; const cts = g.filter(w => w.ct != null).map(w => w.ct);
      if (cts.length >= 3) { const m = median(cts); g.forEach(w => { if (w.ct != null && Math.abs(w.ct - m) > 0.75) w.flags.push(`${(w.ct - m > 0 ? '+' : '')}${(w.ct - m).toFixed(2)} cycles from replicate median`); }); }
      if (cts.length >= 1 && cts.length < g.length && !g.every(isNTC)) g.forEach(w => { if (w.ct == null && w.amp) w.flags.push('Undetermined while replicates amplified'); });
    }
    // summaries
    const order = []; wells.forEach(w => { if (!order.includes(w.sample)) order.push(w.sample); });
    const targets = []; wells.forEach(w => { if (!targets.includes(w.target)) targets.push(w.target); });
    const summary = [];
    for (const s of order) for (const t of targets) {
      const g = groups[s + '|' + t]; if (!g) continue;
      const used = g.filter(w => !w.excluded); const cts = used.filter(w => w.ct != null).map(w => w.ct);
      const sdv = sd(cts);
      summary.push({ sample: s, target: t, n: used.length, nAmp: cts.length, mean: cts.length ? mean(cts) : null, sd: sdv, highsd: sdv != null && sdv > 0.5, excluded: g.length - used.length, ntc: g.every(isNTC) });
    }
    return { wells, summary, samples: order, targets };
  }

  function deltaTable(an, target, ref, controls) {
    const get = (s, t) => an.summary.find(x => x.sample === s && x.target === t);
    const rows = [];
    for (const s of an.samples) {
      const a = get(s, target), b = get(s, ref); if (!a || !b || a.ntc) continue;
      const d = a.mean != null && b.mean != null ? b.mean - a.mean : null;
      const dsd = a.sd != null && b.sd != null ? Math.sqrt(a.sd ** 2 + b.sd ** 2) : null;
      rows.push({ sample: s, ctT: a.mean, ctR: b.mean, d, dsd });
    }
    rows.forEach(r => {
      const c = controls[r.sample]; const cr = c && rows.find(x => x.sample === c);
      r.control = c || ''; r.ddct = cr && r.d != null && cr.d != null ? r.d - cr.d : null; r.fold = r.ddct != null ? Math.pow(2, r.ddct) : null;
    });
    return rows;
  }

  const api = { parseEDS, parseSheet, analyze, deltaTable, autoThreshold, isNTC, ctOf, protocolText, thresholdFor };
  if (typeof module !== 'undefined') module.exports = api; else root.QPCR = api;
})(typeof window !== 'undefined' ? window : globalThis);
