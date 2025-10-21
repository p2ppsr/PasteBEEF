import React, { useState, useEffect, useTransition } from 'react';
import { createRoot } from 'react-dom/client';

// Core SDK bits
import { Beef, Transaction, defaultBroadcaster, WhatsOnChainBroadcaster, Teranode, ARC } from '@bsv/sdk';

// Types & helpers from SDK we’ll touch implicitly (via getters/methods)
type Network = 'main' | 'test' | 'stn';

type ParsedBeef = {
  beef: Beef;
  txids: string[];
  beefBytes: number;
};

type Metrics = {
  bumps: number;
  txCount: number;
  largestTxSize: number;
  avgTxSize: number;
  maxInputDepth: number;
  txSizes: Record<string, number>;
};

const UI = {
  // Design system tokens (kept tight & coherent)
  bg: '#0b0f14',
  panel: '#0d131a',
  inset: '#0f1720',
  text: '#e6f0ff',
  subtext: '#a4b3c7',
  accent: '#66e1b6',
  danger: '#ff7a90',
  warn: '#ffd166',
  border: 'rgba(255,255,255,.08)',
  glow: '0 0 0 1px rgba(255,255,255,.04), 0 8px 30px rgba(0,0,0,.45)',
  radius: 14,
  radiusSm: 10,
  pad: '14px',
};

function bytesToHuman(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

/** Detect likely encoding (hex/base64/utf8) and normalize. */
function normalizeBeefInput(raw: string): { enc: 'hex' | 'base64' | 'utf8'; text: string } {
  const s = raw.trim();
  const hexish = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
  if (hexish) return { enc: 'hex', text: s.toLowerCase() };
  // crude b64 sniff
  const b64ish = /^[A-Za-z0-9+/=\s]+$/.test(s) && s.length % 4 === 0;
  if (b64ish) return { enc: 'base64', text: s.replace(/\s+/g, '') };
  return { enc: 'utf8', text: s };
}

/** Safe Transaction byte length (prefers rawTx when available). */
function txByteLengthMaybe(btx: any): number {
  try {
    const raw: number[] | undefined = btx?.rawTx;
    if (raw && Array.isArray(raw)) return raw.length;
    const tx = btx?.tx as Transaction | undefined;
    if (tx) return tx.toBinary().length;
  } catch {}
  return 0;
}

/** Build dependency depth (max path from a tx to a proven root or txid-only). */
function computeMaxDepth(beef: Beef, byId: Map<string, any>): number {
  const cache = new Map<string, number>();
  const seenMissing = new Set<string>();

  // treat any tx that has a Merkle proof (btx.hasProof) or is txid-only as a root (depth 0)
  const depthOf = (txid: string): number => {
    if (cache.has(txid)) return cache.get(txid)!;
    const btx = byId.get(txid);
    if (!btx) {
      // unknown parent; count as edge and stop (doesn’t kill metric)
      seenMissing.add(txid);
      cache.set(txid, 0);
      return 0;
    }
    if (btx.hasProof || btx.isTxidOnly) {
      cache.set(txid, 0);
      return 0;
    }
    const parents: string[] = btx.inputTxids || [];
    let best = 0;
    for (const p of parents) {
      best = Math.max(best, 1 + depthOf(p));
    }
    cache.set(txid, best);
    return best;
  };

  let max = 0;
  for (const btx of (beef as any).txs as any[]) {
    const d = depthOf(btx.txid);
    if (d > max) max = d;
  }
  return max;
}

/** Compute “developer-sane” metrics for dashboards. */
function computeMetrics(beef: Beef): Metrics {
  const txs: any[] = (beef as any).txs || [];
  const txSizes: Record<string, number> = {};
  for (const btx of txs) {
    txSizes[btx.txid] = txByteLengthMaybe(btx);
  }
  const sizes = Object.values(txSizes);
  const largestTxSize = sizes.length ? Math.max(...sizes) : 0;
  const avgTxSize = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;

  const byId = new Map<string, any>(txs.map((btx) => [btx.txid, btx]));
  const maxInputDepth = computeMaxDepth(beef, byId);

  return {
    bumps: (beef as any).bumps?.length ?? 0,
    txCount: txs.length,
    largestTxSize,
    avgTxSize,
    maxInputDepth,
    txSizes,
  };
}

/** Try to parse a BEEF (hex/base64/utf8). Returns ParsedBeef or throws. */
function parseBeef(raw: string): ParsedBeef {
  const { enc, text } = normalizeBeefInput(raw);
  const beef = Beef.fromString(text, enc);
  const txids = ((beef as any).txs as any[]).map((btx) => btx.txid);
  const beefBytes = beef.toBinary().length;
  return { beef, txids, beefBytes };
}

function download(filename: string, mime: string, data: string | Uint8Array) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Section({ title, children, right }: { title: string; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="section">
      <div className="sectionHead">
        <h3>{title}</h3>
        {right ? <div className="right">{right}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={"value " + (mono ? "mono" : "")}>{value}</div>
    </div>
  );
}

function Tag({ children, tone = 'ok' as 'ok' | 'warn' | 'bad' }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

function AnimatedCard({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

function Shimmer({ width = '100%' }: { width?: string }) {
  return <div className="shimmer" style={{ width }} />;
}

// ============================================================================
// Main App
// ============================================================================

export default function PasteBEEF() {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedBeef | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [selectedTxid, setSelectedTxid] = useState<string | null>(null);
  const [network, setNetwork] = useState<Network>('main');
  const [isPending, startTransition] = useTransition();

  // For secondary merge input
  const [mergeRaw, setMergeRaw] = useState('');

  // Broadcast state
  const [broadcasterKind, setBroadcasterKind] = useState<'woc' | 'teranode' | 'arc' | 'default'>('woc');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-parse on paste into the starter textarea; explicit parse for very large strings.
  const handleInitialParse = () => {
    setError(null);
    startTransition(() => {
      try {
        const res = parseBeef(raw);
        setParsed(res);
        setSelectedTxid(res.txids.at(-1) || null);
        setMetrics(computeMetrics(res.beef));
      } catch (e: any) {
        setError(e?.message || String(e));
        setParsed(null);
        setMetrics(null);
      }
    });
  };

  const handleMerge = () => {
    if (!parsed) return;
    setError(null);
    try {
      const other = parseBeef(mergeRaw);
      const cloned = parsed.beef.clone();
      cloned.mergeBeef(other.beef);
      const txids = ((cloned as any).txs as any[]).map((btx: any) => btx.txid);
      setParsed({ beef: cloned, txids, beefBytes: cloned.toBinary().length });
      setMetrics(computeMetrics(cloned));
      setMergeRaw('');
    } catch (e: any) {
      setError(`Merge failed: ${e?.message || e}`);
    }
  };

  const exportBeefHex = () => {
    if (!parsed) return;
    const hex = parsed.beef.toHex();
    download('beef.hex.txt', 'text/plain', hex);
  };

  const exportAtomicForSelected = () => {
    if (!parsed || !selectedTxid) return;
    // Beef has toBinaryAtomic(txid). Transaction also supports toHexAtomicBEEF() when you have a Transaction.
    // We’ll use Beef path as we have the full set on hand.
    try {
      const ab = parsed.beef.toBinaryAtomic(selectedTxid);
      const hex = Array.from(ab).map((b) => b.toString(16).padStart(2, '0')).join('');
      download(`atomic-${selectedTxid}.hex.txt`, 'text/plain', hex);
    } catch (e: any) {
      setError(`Atomic export failed: ${e?.message || e}`);
    }
  };

  const exportSelectedTxAsHex = () => {
    if (!parsed || !selectedTxid) return;
    try {
      const tx = Transaction.fromBEEF(parsed.beef.toBinary(), selectedTxid);
      download(`tx-${selectedTxid}.hex.txt`, 'text/plain', tx.toHex());
    } catch (e: any) {
      setError(`TX export failed: ${e?.message || e}`);
    }
  };

  const handleBroadcast = async () => {
    if (!parsed || !selectedTxid) return;
    setBroadcasting(true);
    setBroadcastResult(null);
    setError(null);
    try {
      // Pull the subject tx from the BEEF
      const tx = Transaction.fromBEEF(parsed.beef.toBinary(), selectedTxid);

      // Choose broadcaster
      let b: any;
      if (broadcasterKind === 'default') {
        b = defaultBroadcaster?.() ?? new WhatsOnChainBroadcaster(network);
      } else if (broadcasterKind === 'woc') {
        b = new WhatsOnChainBroadcaster(network);
      } else if (broadcasterKind === 'teranode') {
        // This will need a proper Teranode endpoint when you actually wire it up
        b = new Teranode(`https://tn.${network}.example.com`);
      } else if (broadcasterKind === 'arc') {
        // Basic ARC example with no auth; replace with your ARC config as needed
        b = new ARC({ url: `https://arc.${network}.example.com` } as any);
      }

      const result = await tx.broadcast(b);
      setBroadcastResult(JSON.stringify(result, null, 2));
    } catch (e: any) {
      setError(`Broadcast failed: ${e?.message || e}`);
    } finally {
      setBroadcasting(false);
    }
  };

  const resetAll = () => {
    setRaw('');
    setParsed(null);
    setMetrics(null);
    setSelectedTxid(null);
    setError(null);
    setBroadcastResult(null);
    setMergeRaw('');
  };

  // Derived visuals
  const txids = parsed?.txids ?? [];
  const beefBytes = parsed?.beefBytes ?? 0;

  // Animated mount helper
  useEffect(() => {
    document.title = 'PasteBEEF — BSV BEEF Tool';
  }, []);

  return (
    <div className="wrap">
      <style>{CSS}</style>

      {/* Entry Screen */}
      {!parsed && (
        <div className="entry">
          <AnimatedCard>
            <h1>PasteBEEF</h1>
            <p className="lede">
              Paste any <strong>BEEF</strong> (Atomic or full) below. We’ll analyze it and give you the tools to merge, export, transform, and broadcast.
            </p>

            <textarea
              className="beefInput"
              placeholder="Paste BEEF here (hex or base64)…"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <div className="row">
              <button className="primary" disabled={!raw.trim()} onClick={handleInitialParse}>
                Analyze BEEF
              </button>
              <button className="ghost" onClick={() => setRaw('')}>
                Clear
              </button>
            </div>

            {isPending ? (
              <div className="pending">
                <Shimmer width="80%" />
                <Shimmer width="60%" />
                <Shimmer width="90%" />
              </div>
            ) : null}

            {error && (
              <div className="error">
                <strong>Parse error</strong>
                <pre>{error}</pre>
              </div>
            )}

            <footer className="footnote">
              Tip: Hex is fastest. Base64/UTF-8 also works — we auto-detect.
            </footer>
          </AnimatedCard>
        </div>
      )}

      {/* Main Screen */}
      {parsed && metrics && (
        <div className="main">
          <div className="topbar">
            <div className="brand" onClick={resetAll}>PasteBEEF</div>
            <div className="topActions">
              <button className="ghost" onClick={exportBeefHex}>Export BEEF</button>
              <button className="ghost" onClick={exportSelectedTxAsHex} disabled={!selectedTxid}>Export TX (hex)</button>
              <button className="ghost" onClick={exportAtomicForSelected} disabled={!selectedTxid}>Export Atomic BEEF</button>
              <button className="warn" onClick={resetAll}>Start Over</button>
            </div>
          </div>

          <div className="grid">
            {/* Left: Metrics & Actions */}
            <div className="col">
              <Section
                title="BEEF Overview"
                right={<Tag tone="ok">{bytesToHuman(beefBytes)}</Tag>}
              >
                <div className="stats">
                  <Stat label="Transactions" value={metrics.txCount} />
                  <Stat label="BUMPs (Merkle Paths)" value={metrics.bumps} />
                  <Stat label="Max Input Depth" value={metrics.maxInputDepth} />
                  <Stat label="Largest TX Size" value={bytesToHuman(metrics.largestTxSize)} />
                  <Stat label="Avg TX Size" value={bytesToHuman(metrics.avgTxSize)} />
                </div>
                <div className="subtle">
                  These numbers reflect the full BEEF (including shared ancestors and proofs).
                </div>
              </Section>

              <Section title="Broadcast">
                <div className="row">
                  <label className="lbl">Network</label>
                  <select value={network} onChange={(e) => setNetwork(e.target.value as Network)}>
                    <option value="main">main</option>
                    <option value="test">test</option>
                    <option value="stn">stn</option>
                  </select>
                </div>
                <div className="row">
                  <label className="lbl">Broadcaster</label>
                  <select value={broadcasterKind} onChange={(e) => setBroadcasterKind(e.target.value as any)}>
                    <option value="woc">WhatsOnChain</option>
                    <option value="default">SDK Default</option>
                    <option value="teranode">Teranode</option>
                    <option value="arc">ARC</option>
                  </select>
                </div>
                <div className="row">
                  <label className="lbl">Subject TXID</label>
                  <input className="txidInput" value={selectedTxid ?? ''} onChange={(e) => setSelectedTxid(e.target.value.trim() || null)} placeholder="(uses last tx by default)" />
                  <button className="primary" onClick={handleBroadcast} disabled={!selectedTxid || broadcasting}>
                    {broadcasting ? 'Broadcasting…' : 'Broadcast'}
                  </button>
                </div>

                {broadcastResult && (
                  <div className="result">
                    <div className="row rowBetween">
                      <strong>Result</strong>
                      <button className="mini" onClick={() => copy(broadcastResult!)}>Copy</button>
                    </div>
                    <pre className="mono small">{broadcastResult}</pre>
                  </div>
                )}
              </Section>

              <Section title="Merge Another BEEF">
                <textarea className="beefInput small" placeholder="Paste additional BEEF to merge…" value={mergeRaw} onChange={(e) => setMergeRaw(e.target.value)} />
                <div className="row">
                  <button className="primary" disabled={!mergeRaw.trim()} onClick={handleMerge}>Merge</button>
                  <button className="ghost" onClick={() => setMergeRaw('')}>Clear</button>
                </div>
                <div className="subtle">
                  We clone your current BEEF, merge, re-sort, and update metrics.
                </div>
              </Section>

              {error && (
                <Section title="Errors">
                  <div className="error">
                    <pre className="mono small">{error}</pre>
                  </div>
                </Section>
              )}
            </div>

            {/* Right: TX list & per-tx details */}
            <div className="col">
              <Section title="Transactions">
                <div className="txList">
                  {txids.map((txid) => {
                    const sz = metrics.txSizes[txid] ?? 0;
                    const isSelected = txid === selectedTxid;
                    return (
                      <div key={txid} className={"txRow " + (isSelected ? "sel" : "")} onClick={() => setSelectedTxid(txid)}>
                        <span className="dot" />
                        <span className="txid mono">{txid}</span>
                        <span className="size">{bytesToHuman(sz)}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>

              <Section title="Selected Transaction">
                {!selectedTxid ? (
                  <div className="subtle">Choose a TX on the left.</div>
                ) : (
                  <TxDetails beef={parsed.beef} txid={selectedTxid} />
                )}
              </Section>
            </div>
          </div>

          <footer className="footer">
            <span>Built on <strong>@bsv/sdk</strong>. BEEF/Atomic BEEF support via core SDK.</span>
          </footer>
        </div>
      )}
    </div>
  );
}

function TxDetails({ beef, txid }: { beef: Beef; txid: string }) {
  const [hex, setHex] = useState<string | null>(null);
  const [atomicHex, setAtomicHex] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setHex(null);
    setAtomicHex(null);
    // Defer heavy conversion a bit to keep UI snappy
    const h = window.setTimeout(() => {
      try {
        const tx = Transaction.fromBEEF(beef.toBinary(), txid);
        const h1 = tx.toHex();
        const ab = beef.toBinaryAtomic(txid);
        const h2 = Array.from(ab).map((b) => b.toString(16).padStart(2, '0')).join('');
        if (alive) {
          setHex(h1);
          setAtomicHex(h2);
        }
      } catch (e) {
        if (alive) {
          setHex('(unable to render tx hex)');
          setAtomicHex('(unable to render atomic beef)');
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [beef, txid]);

  return (
    <div className="txDetails">
      <div className="row rowBetween">
        <div className="pill">TXID</div>
        <code className="mono">{txid}</code>
      </div>
      {loading ? (
        <>
          <Shimmer width="100%" />
          <Shimmer width="90%" />
          <Shimmer width="95%" />
        </>
      ) : (
        <>
          <div className="row rowBetween">
            <div className="pill">TX (hex)</div>
            <button className="mini" disabled={!hex || hex.startsWith('(')} onClick={() => copy(hex!)}>Copy</button>
          </div>
          <pre className="mono small code">{hex ?? '—'}</pre>

          <div className="row rowBetween">
            <div className="pill">Atomic BEEF (hex)</div>
            <button className="mini" disabled={!atomicHex || atomicHex.startsWith('(')} onClick={() => copy(atomicHex!)}>Copy</button>
          </div>
          <pre className="mono small code">{atomicHex ?? '—'}</pre>
        </>
      )}
    </div>
  );
}

// ============================================================================
// CSS — tight, animated, resilient for large payloads (no padding glitches).
// ============================================================================

const CSS = `
:root {
  --bg: ${UI.bg};
  --panel: ${UI.panel};
  --inset: ${UI.inset};
  --text: ${UI.text};
  --subtext: ${UI.subtext};
  --accent: ${UI.accent};
  --danger: ${UI.danger};
  --warn: ${UI.warn};
  --border: ${UI.border};
  --radius: ${UI.radius}px;
  --radiusSm: ${UI.radiusSm}px;
  --pad: ${UI.pad};
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  background: radial-gradient(1200px 800px at 10% -20%, #12202b 0%, var(--bg) 40%) no-repeat, var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji";
  line-height: 1.4;
}

.wrap { min-height: 100%; display: flex; align-items: stretch; justify-content: center; }
.entry, .main { width: min(1200px, 100%); padding: 24px; }

.card {
  background: linear-gradient(180deg, var(--panel), var(--inset));
  border-radius: var(--radius);
  box-shadow: ${UI.glow};
  padding: clamp(16px, 3vw, 28px);
  border: 1px solid var(--border);
  overflow: hidden;
  animation: floatIn .5s ease-out both;
}
@keyframes floatIn {
  from { opacity: 0; transform: translateY(12px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

h1 { margin: 0 0 10px; letter-spacing: .2px; }
h3 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .2px; }
.lede { color: var(--subtext); margin: 0 0 12px; }

.beefInput {
  width: 100%;
  min-height: 180px;
  padding: 12px 14px;
  border-radius: var(--radiusSm);
  background: #0b1118;
  border: 1px solid var(--border);
  color: var(--text);
  resize: vertical;
  outline: none;
  line-height: 1.45;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
}
.beefInput.small { min-height: 120px; }

.row { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.rowBetween { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lbl { width: 120px; color: var(--subtext); font-size: 13px; }

.primary, .ghost, .warn, .mini {
  border: 0; border-radius: 10px; padding: 10px 14px; cursor: pointer;
  background: var(--accent); color: #04120b; font-weight: 700; letter-spacing: .2px;
  box-shadow: 0 6px 18px rgba(102, 225, 182, .15);
  transition: transform .1s ease, filter .2s ease, opacity .2s ease;
}
.primary:disabled { opacity: .5; cursor: not-allowed; }
.ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
.warn { background: var(--warn); color: #2a2100; }
.mini { padding: 6px 10px; font-size: 12px; background: #111a23; color: var(--text); border: 1px solid var(--border); }

.pending { margin-top: 12px; display: grid; gap: 8px; }
.shimmer {
  height: 10px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.08), rgba(255,255,255,.04));
  background-size: 300% 100%;
  animation: shimmer 1.2s infinite linear;
}
@keyframes shimmer { 0%{ background-position: 200% 0; } 100%{ background-position: -200% 0; } }

.section {
  background: linear-gradient(180deg, var(--panel), #0b1118 140%);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  box-shadow: ${UI.glow};
  padding: 16px;
  margin-bottom: 16px;
}
.sectionHead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (min-width: 900px) {
  .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.stat {
  padding: 12px;
  background: #0b1118;
  border: 1px solid var(--border);
  border-radius: 12px;
  display: grid;
  gap: 4px;
}
.stat .label { color: var(--subtext); font-size: 12px; }
.stat .value { font-size: 16px; font-weight: 800; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace; }

.tag {
  display: inline-block; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .2px;
  background: #0b1118; border: 1px solid var(--border); color: var(--text);
}
.tag.ok { box-shadow: inset 0 0 0 1px rgba(102,225,182,.15); }
.tag.warn { box-shadow: inset 0 0 0 1px rgba(255,209,102,.15); }
.tag.bad { box-shadow: inset 0 0 0 1px rgba(255,122,144,.15); }

.topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px;
}
.brand {
  font-weight: 900; letter-spacing: .3px; cursor: pointer; user-select: none;
  background: linear-gradient(90deg, #8ff3d2, #c1ffe9); color: #061811;
  padding: 8px 12px; border-radius: 12px; border: 1px solid var(--border);
}
.topActions { display: flex; gap: 8px; flex-wrap: wrap; }

.grid {
  display: grid; gap: 16px;
  grid-template-columns: 1fr;
}
@media (min-width: 980px) {
  .grid { grid-template-columns: 1.05fr .95fr; }
}
.col { min-width: 0; }

.txList {
  display: grid;
  gap: 6px;
  max-height: 48vh;
  overflow: auto;
  padding-right: 4px;
}
.txRow {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  background: #0b1118;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: background .15s ease, transform .05s ease;
}
.txRow:hover { background: #0e151f; }
.txRow.sel { outline: 2px solid rgba(102,225,182,.35); }
.txRow .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--accent); }
.txRow .txid { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.txRow .size { color: var(--subtext); font-size: 12px; }

.txDetails .pill {
  font-size: 11px; color: var(--subtext); background: #0b1118; border: 1px solid var(--border);
  padding: 6px 8px; border-radius: 999px;
}
.code {
  background: #0b1118; border: 1px dashed rgba(255,255,255,.08); padding: 12px; border-radius: 10px; max-height: 28vh; overflow: auto;
}
.subtle { color: var(--subtext); font-size: 12px; margin-top: 6px; }
.result { margin-top: 10px; }
.error {
  background: rgba(255,122,144,.08);
  border: 1px solid rgba(255,122,144,.25);
  color: ${UI.text};
  padding: 10px; border-radius: 10px;
}
.footer {
  margin: 18px 0 6px; color: var(--subtext); font-size: 12px; text-align: center;
}
.txidInput {
  flex: 1; min-width: 260px;
  background: #0b1118; color: var(--text);
  border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
}
select, input {
  background: #0b1118; color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
}
button:active { transform: translateY(1px); }
`;

const root = createRoot(document.getElementById('root')!);
root.render(<PasteBEEF />);
