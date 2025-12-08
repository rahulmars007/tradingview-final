import React, { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { createChart, ColorType } from 'lightweight-charts';

/* Utilities */
const normalizeNumber = (v) => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[,₹\s]/g, '').replace(/--/g, '');
  return parseFloat(cleaned);
};

const tryParseDateToSec = (dateStr, assumeMs = false) => {
  if (dateStr === null || dateStr === undefined) return NaN;
  const s = String(dateStr).trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (assumeMs) return Math.floor(n / 1000);
    if (s.length > 10) return Math.floor(n / 1000);
    return n;
  }
  const iso = Date.parse(s);
  if (!isNaN(iso)) return Math.floor(iso / 1000);
  const d = s.replace(/\./g, '/').replace(/-/g, '/');
  const parts = d.split('/');
  if (parts.length === 3) {
    let [p1, p2, p3] = parts; let day, month, year;
    if (p3.length === 4) { day = p1; month = p2; year = p3; }
    else if (p1.length === 4) { year = p1; month = p2; day = p3; }
    else { day = p1; month = p2; year = p3; }
    const rebuilt = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const parsed = Date.parse(rebuilt);
    if (!isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return NaN;
};

const median = (arr) => { const a = arr.filter(x => isFinite(x)).slice().sort((x, y) => x - y); if (!a.length) return NaN; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/* Simple SMA */
const computeSMA = (data, period) => { const res = []; if (!data || !data.length) return res; const window = []; let sum = 0; for (let i = 0; i < data.length; i++) { const v = data[i].close; window.push(v); sum += v; if (window.length > period) sum -= window.shift(); if (window.length === period) res.push({ time: data[i].time, value: sum / period }); } return res; };

/* CSV uploader with auto-detect */
function CSVUploader({ onParsed }) {
  const fileRef = useRef(null);
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [mapping, setMapping] = useState({ date: '', open: '', high: '', low: '', close: '', volume: '' });
  const [assumeDateMs, setAssumeDateMs] = useState(false);

  const handleFile = (file) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, transformHeader: h => h.trim(), complete: (results) => {
        const rows = results.data || [];
        if (!rows.length) { alert('No rows parsed'); return; }
        setRawRows(rows); setPreviewRows(rows.slice(0, 10)); const keys = Object.keys(rows[0] || {}); setHeaders(keys);
        const auto = autoDetect(keys); setMapping(m => ({ ...m, ...auto }));
        if (auto.date && auto.open && auto.high && auto.low && auto.close) {
          setTimeout(() => applyMapping(rows, auto, assumeDateMs), 200);
        }
      }, error: (err) => { console.error(err); alert('Parse error'); }
    });
  };

  const autoDetect = (keys) => { const find = (cands) => keys.find(k => cands.some(c => k.toLowerCase().includes(c))); return { date: find(['timestamp', 'date', 'time']) || '', open: find(['open', 'o']) || '', high: find(['high', 'h']) || '', low: find(['low', 'l']) || '', close: find(['close', 'c', 'last']) || '', volume: find(['volume', 'vol', 'v']) || '' }; };

  const applyMapping = (rowsArg = null, mappingArg = null, assumeMs = false) => {
    const rows = rowsArg || rawRows; const mappingObj = mappingArg || mapping;
    if (!rows.length) return;
    const { date, open, high, low, close, volume } = mappingObj;
    if (!date || !open || !high || !low || !close) { return; }
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; const t = tryParseDateToSec(r[date], assumeMs); if (isNaN(t)) continue;
      const o = normalizeNumber(r[open]); const h = normalizeNumber(r[high]); const l = normalizeNumber(r[low]); const c = normalizeNumber(r[close]); const v = volume ? normalizeNumber(r[volume]) : undefined;
      if ([o, h, l, c].some(x => isNaN(x))) continue; out.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
    }
    out.sort((a, b) => a.time - b.time); onParsed(out);
  };

  return (
    <div style={{ padding: 10, borderRight: '1px solid #eee', minWidth: 360 }}>
      <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={() => fileRef.current.click()}>Upload CSV</button>
        <button onClick={() => { setRawRows([]); setHeaders([]); setPreviewRows([]); onParsed([]); }}>Clear</button>
      </div>


    </div>
  );
}

/* TradingChart: separate volume scale + clipping */
function TradingChart({ ohlc, theme = 'dark', indicators = { sma: 20 }, onLegendChange }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);

  const smaRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current; if (!container) return; container.style.height = 'calc(100vh - 120px)'; container.style.position = 'relative';
    const chart = createChart(container, {
      layout: { background: { type: ColorType.Solid, color: theme === 'dark' ? '#0b1226' : '#fff' }, textColor: theme === 'dark' ? '#d1d4dc' : '#1b1b1b' },
      width: container.clientWidth,
      height: container.clientHeight,
      rightPriceScale: { borderColor: theme === 'dark' ? '#2b2b43' : '#e6e6e6' },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time, tickMarkType, locale) => {
          const date = new Date(time * 1000);
          // Year=0, Month=1, DayOfMonth=2, Time=3, TimeWithSeconds=4
          // Force IST formatting manually
          const istDate = date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
          // Simple heuristic since toLocaleString returns full string:
          // "06 Nov 25, 09:15"
          // We want just time for intraday, or date for day boundaries.
          // tickMarkType < 3 means Day/Month/Year
          if (tickMarkType < 3) {
            return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: '2-digit' });
          }
          return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
        }
      },
      localization: {
        timeFormatter: (time) => {
          return new Date(time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
        }
      }
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
    candleRef.current = candleSeries;



    const smaSeries = chart.addLineSeries({ color: '#f1c40f', lineWidth: 2 });
    smaRef.current = smaSeries;

    const ro = new ResizeObserver(() => { if (!chartRef.current || !container) return; chartRef.current.applyOptions({ width: container.clientWidth, height: container.clientHeight }); });
    ro.observe(container);



    chart.subscribeCrosshairMove(param => {
      if (!param || !param.time || !param.seriesData) {
        onLegendChange(null);
        return;
      }
      const seriesData = param.seriesData;
      const c = seriesData.get(candleSeries);
      const s = seriesData.get(smaSeries);

      if (c) {
        onLegendChange({
          time: param.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          sma: s
        });
      } else {
        onLegendChange(null);
      }
    });

    return () => { ro.disconnect(); chart.remove(); };
  }, [theme]);



  useEffect(() => {
    const chart = chartRef.current; if (!chart) return; const candleSeries = candleRef.current; const smaSeries = smaRef.current; if (!candleSeries) return;
    const lcData = (ohlc || []).map(r => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close })); candleSeries.setData(lcData);
    if (indicators && indicators.sma) { const sma = computeSMA(ohlc, indicators.sma); smaSeries.setData(sma); } else { smaSeries.setData([]); }
    try { chart.timeScale().fitContent(); } catch (e) { }
  }, [ohlc, indicators]);

  return <div style={{ position: 'relative', width: '100%' }}><div ref={containerRef} style={{ width: '100%' }} /></div>;
}

export default function App() {
  const [data, setData] = useState([]);
  const [theme, setTheme] = useState('dark');
  const [sma, setSma] = useState(20);
  const [legendData, setLegendData] = useState(null);

  const formatVal = (n) => n ? Number(n).toFixed(2) : '—';

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #eee' }}>
        <div style={{ flex: '0 0 380px' }}><CSVUploader onParsed={(d) => setData(d)} /></div>
        <div style={{ flex: 1, padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ fontWeight: 'bold' }}>TradingView-like Chart</div>
            <label style={{ marginRight: 12 }}>SMA <input type="number" value={sma} onChange={e => setSma(Math.max(1, Number(e.target.value) || 1))} style={{ width: 60, marginLeft: 6 }} /></label>

            {legendData && (
              <div style={{ display: 'flex', gap: 12, fontSize: 13, fontFamily: 'monospace' }}>
                <div style={{ fontWeight: 'bold' }}>
                  {new Date(legendData.time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                </div>
                <div style={{ color: legendData.close >= legendData.open ? '#26a69a' : '#ef5350' }}>
                  <span style={{ color: theme === 'dark' ? '#787b86' : '#5d606b' }}>O</span> {formatVal(legendData.open)}&nbsp;
                  <span style={{ color: theme === 'dark' ? '#787b86' : '#5d606b' }}>H</span> {formatVal(legendData.high)}&nbsp;
                  <span style={{ color: theme === 'dark' ? '#787b86' : '#5d606b' }}>L</span> {formatVal(legendData.low)}&nbsp;
                  <span style={{ color: theme === 'dark' ? '#787b86' : '#5d606b' }}>C</span> {formatVal(legendData.close)}
                </div>
                {legendData.sma !== undefined && (
                  <div style={{ color: '#f1c40f' }}>
                    <span style={{ color: theme === 'dark' ? '#787b86' : '#5d606b' }}>SMA</span> {formatVal(legendData.sma)}
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><label>Theme<select value={theme} onChange={e => setTheme(e.target.value)} style={{ marginLeft: 6 }}><option value="dark">Dark</option><option value="light">Light</option></select></label></div>
        </div>
      </div>
      <div style={{ flex: 1 }}><TradingChart ohlc={data} theme={theme} indicators={{ sma }} onLegendChange={setLegendData} /></div>
    </div>
  );
}
