import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => marked.parse(source ?? '', { async: false }) as string, [source]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
