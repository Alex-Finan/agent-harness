import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import mermaid from 'mermaid';

marked.setOptions({ gfm: true, breaks: false });

// Initialize once per module load. `loose` lets diagrams use raw HTML labels;
// startOnLoad: false because we render imperatively after marked emits HTML.
let mermaidInitialized = false;
function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif'
  });
  mermaidInitialized = true;
}

let mermaidIdCounter = 0;

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => marked.parse(source ?? '', { async: false }) as string, [source]);
  const ref = useRef<HTMLDivElement>(null);

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
          wrapper.className = 'mermaid-rendered overflow-x-auto rounded border border-slate-200 bg-white p-3 my-3';
          wrapper.innerHTML = svg;
          pre.replaceWith(wrapper);
        } catch (err) {
          if (cancelled) return;
          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-error rounded border border-red-200 bg-red-50 p-3 my-3 text-xs text-red-800';
          wrapper.textContent = `Mermaid render error: ${(err as Error).message}\n\n${src}`;
          pre.replaceWith(wrapper);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html]);

  return <div ref={ref} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
