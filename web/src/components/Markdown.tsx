import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import mermaid from 'mermaid';

marked.setOptions({ gfm: true, breaks: false });

/**
 * Mermaid init tuned for our run-detail panels:
 *
 *   - `theme: 'base'` + custom `themeVariables` for higher-contrast nodes,
 *     better border weight, and a slate / blue palette that matches the
 *     surrounding chrome (rather than mermaid's default washed-out pastels).
 *   - `useMaxWidth: false` so the SVG keeps its intrinsic width — the
 *     wrapper handles horizontal scroll when the graph is wider than the
 *     panel, instead of squishing nodes until labels truncate.
 *   - `htmlLabels: true` + generous `wrappingWidth` so long labels wrap on
 *     word boundaries rather than mid-word.
 *   - Generous `nodeSpacing` / `rankSpacing` so adjacent nodes don't crash
 *     visually into each other.
 *   - `curve: 'basis'` for smoother edge paths than the default polyline.
 */
let mermaidInitialized = false;
function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    themeVariables: {
      // Node fills + strokes — slate-50 fill, slate-400 stroke, slate-900 text.
      primaryColor: '#f8fafc',
      primaryBorderColor: '#94a3b8',
      primaryTextColor: '#0f172a',
      // Edge styling.
      lineColor: '#475569',
      // Cluster (subgraph) styling.
      clusterBkg: '#f1f5f9',
      clusterBorder: '#cbd5e1',
      // Notes.
      noteBkgColor: '#fef3c7',
      noteBorderColor: '#f59e0b',
      noteTextColor: '#78350f',
      // Larger base font size — default 14px reads tiny inside the run panel.
      fontSize: '15px'
    },
    flowchart: {
      // Keep intrinsic SVG width — `useMaxWidth:true` was scaling the whole
      // diagram down to fit the panel, which compressed every node and
      // chopped labels at their bounding box. With useMaxWidth:false the
      // wrapper's overflow-x-auto handles horizontal scroll for wide
      // diagrams while letting each node breathe at its natural size.
      useMaxWidth: false,
      htmlLabels: true,
      padding: 18,
      nodeSpacing: 60,
      rankSpacing: 80,
      // Label wrap width — bumped so multi-clause node labels break on word
      // boundaries instead of overflowing the node bounding box.
      wrappingWidth: 340,
      curve: 'basis'
    },
    sequence: { useMaxWidth: false, wrap: true },
    gantt: { useMaxWidth: false },
    er: { useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false }
  });
  mermaidInitialized = true;
}

let mermaidIdCounter = 0;

export function Markdown({ source }: { source: string }) {
  const html = useMemo(
    () => marked.parse(source ?? '', { async: false }) as string,
    [source]
  );
  const ref = useRef<HTMLDivElement>(null);
  const [zoomedSvg, setZoomedSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ensureMermaidInit();

    const blocks = Array.from(
      ref.current.querySelectorAll<HTMLElement>('pre > code.language-mermaid')
    );
    if (blocks.length === 0) return;

    let cancelled = false;

    (async () => {
      for (const code of blocks) {
        const pre = code.parentElement;
        if (!pre) continue;
        const src = code.textContent ?? '';
        const id = `mermaid-${++mermaidIdCounter}`;
        try {
          const { svg } = await mermaid.render(id, src);
          if (cancelled) return;
          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-rendered group relative my-4';
          wrapper.innerHTML = `
            <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <div class="mermaid-svg-host px-4 py-4">${svg}</div>
            </div>
          `;
          const svgEl = wrapper.querySelector('svg');
          if (svgEl) {
            // Keep intrinsic width so dense diagrams aren't compressed (which
            // was crushing node boxes and clipping labels). Wider-than-panel
            // diagrams scroll horizontally via the wrapper.
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
            svgEl.style.maxWidth = 'none';
            svgEl.style.height = 'auto';
            svgEl.style.display = 'block';
          }

          // "Expand" button that opens the diagram in a fullscreen overlay.
          // Dense planner diagrams are hard to read inside the panel; the
          // overlay lets the user see them at native size, with pan scroll.
          const expand = document.createElement('button');
          expand.type = 'button';
          expand.className =
            'absolute right-2 top-2 rounded-md border border-slate-300 bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm opacity-0 transition group-hover:opacity-100 hover:bg-white';
          expand.textContent = 'Expand ⤢';
          expand.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setZoomedSvg(svg);
          });
          wrapper.appendChild(expand);

          pre.replaceWith(wrapper);
        } catch (err) {
          if (cancelled) return;
          const wrapper = document.createElement('div');
          wrapper.className =
            'mermaid-error rounded border border-rose-200 bg-rose-50 p-3 my-3 text-xs text-rose-800';
          wrapper.textContent = `Mermaid render error: ${(err as Error).message}\n\n${src}`;
          pre.replaceWith(wrapper);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <>
      <div ref={ref} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
      {zoomedSvg ? (
        <MermaidZoomModal svg={zoomedSvg} onClose={() => setZoomedSvg(null)} />
      ) : null}
    </>
  );
}

/**
 * Fullscreen overlay for a single rendered mermaid SVG. Click backdrop or
 * Escape to close. The inner div is scrollable in both axes so big diagrams
 * are explorable instead of being squashed to fit.
 */
function MermaidZoomModal({
  svg,
  onClose
}: {
  svg: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const svgEl = host.querySelector('svg');
    if (!svgEl) return;
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    // Cap so the diagram doesn't render at 3000px on a 4K monitor — readable
    // but not absurd. The modal's scroll handles anything wider.
    svgEl.style.maxWidth = 'min(100%, 1400px)';
    svgEl.style.height = 'auto';
    svgEl.style.display = 'block';
    svgEl.style.margin = '0 auto';
  }, [svg]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-6 lg:p-12"
      onClick={onClose}
    >
      <div
        className="relative flex h-full max-h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Diagram
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
            title="Close (Esc)"
          >
            Close
          </button>
        </div>
        <div
          ref={hostRef}
          className="min-h-0 flex-1 overflow-auto bg-slate-50 p-8"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
