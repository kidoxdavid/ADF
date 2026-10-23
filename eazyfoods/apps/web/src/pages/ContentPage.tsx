import { Fragment, useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../hooks';
import { ErrorBox, Loading, Notice } from '../ui';

/** Tiny, safe renderer for our own policy pages: "## heading", "- bullet" and paragraphs. No raw HTML is ever injected. */
function render(body: string): ReactNode {
  const blocks = body.split(/\n{2,}/);
  return blocks.map((b, i) => {
    const lines = b.split('\n');
    if (lines[0].startsWith('## ')) return <Fragment key={i}><h2>{lines[0].slice(3)}</h2>{lines.length > 1 && <p>{lines.slice(1).join(' ')}</p>}</Fragment>;
    if (lines.every((l) => l.startsWith('- '))) return <ul key={i}>{lines.map((l, k) => <li key={k}>{l.slice(2)}</li>)}</ul>;
    return <p key={i}>{lines.join(' ')}</p>;
  });
}

export function ContentPage() {
  const { slug } = useParams();
  const { data, loading, error, reload } = useApi<{ title: string; body: string; needs_legal_review: boolean }>(`/pages/${slug}`);
  useEffect(() => { if (data) document.title = `${data.title} – EAZyfoods`; }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  return <article className="prose"><h1>{data.title}</h1>{data.needs_legal_review && <Notice tone="warn">This page is a draft and has not been reviewed by a legal professional yet.</Notice>}{render(data.body)}</article>;
}
