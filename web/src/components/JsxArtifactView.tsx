import { LiveProvider, LivePreview, LiveError } from 'react-live';
import React from 'react';

/**
 * Live-render a JSX snippet from a ```jsx fence Claude wrote. react-live
 * transpiles the source with Sucrase and evaluates it in a sandboxed scope.
 *
 * We run in `noInline` mode (multi-statement source allowed; must call
 * `render(<Component />)` at the end). If Claude wrote just a function/const
 * component declaration or a trailing `<Component />` expression, we
 * auto-inject the render call.
 */
export function JsxArtifactView({ source }: { source: string }) {
  const code = normalizeJsxSource(source);
  return (
    <div className="overflow-hidden rounded-lg border border-violet-200 bg-white shadow-sm">
      <div className="border-b border-violet-200 bg-violet-50/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
        Live JSX
      </div>
      <LiveProvider code={code} scope={LIVE_SCOPE} noInline>
        <div className="min-h-[200px] bg-white p-4">
          <LivePreview />
        </div>
        <LiveError className="border-t border-rose-200 bg-rose-50 px-3 py-2 font-mono text-[11px] text-rose-700" />
      </LiveProvider>
    </div>
  );
}

const LIVE_SCOPE = {
  React,
  useState: React.useState,
  useEffect: React.useEffect,
  useMemo: React.useMemo,
  useRef: React.useRef,
  useCallback: React.useCallback,
  useReducer: React.useReducer,
  Fragment: React.Fragment
};

/**
 * Make the snippet runnable under react-live's noInline mode (which requires
 * a `render(<X />)` call):
 *
 * 1. Strip the `// Title:` metadata line if present.
 * 2. If source already contains `render(`, leave it.
 * 3. If source contains a `function ComponentName` or `const ComponentName =`
 *    declaration, append `render(<ComponentName />)`. If the source already
 *    has a trailing `<ComponentName />` expression, strip it first so we
 *    don't end up with both.
 * 4. If source starts with a JSX expression (`<...>`), wrap with `render(...)`.
 */
function normalizeJsxSource(raw: string): string {
  let src = raw.replace(/^\s*\/\/\s*Title:[^\n]*\n/, '').trim();

  if (/\brender\s*\(/.test(src)) return src;

  const componentName =
    src.match(/function\s+([A-Z]\w+)\s*\(/)?.[1] ??
    src.match(/const\s+([A-Z]\w+)\s*=/)?.[1];

  if (componentName) {
    // Drop any trailing `<Component />` expression so we don't double-mount.
    const trailingRe = new RegExp(`\\n?\\s*<\\s*${componentName}\\s*\\/?>\\s*;?\\s*$`);
    src = src.replace(trailingRe, '');
    return `${src}\nrender(<${componentName} />)`;
  }

  // Bare JSX expression.
  if (/^\s*</.test(src)) {
    return `render(${src})`;
  }

  // Last resort: assume the source's final expression is renderable.
  return `render((${src}))`;
}
