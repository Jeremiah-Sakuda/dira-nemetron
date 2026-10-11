'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { label, readJson } from '../lib/format';

interface Note { noteId: string; text: string; source: string; createdAtIso: string }

/** Changes the owner told Hermes about. They run only after this authenticated confirmation. */
export function RelayedNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ text: string; workflowId?: string } | null>(null);

  async function load() {
    const response = await fetch('/api/notes', { cache: 'no-store' });
    const body = await readJson<{ notes: Note[] }>(response);
    if (response.ok) setNotes(body.notes);
  }
  useEffect(() => { void load(); }, []);

  async function decide(note: Note, decision: 'CONFIRMED' | 'DISCARDED') {
    setBusy(note.noteId);
    const response = await fetch(`/api/notes/${note.noteId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
    });
    const body = await readJson<{ run?: { id: string; status: string; mutationSummary?: string } }>(response);
    setMessage(!response.ok ? { text: body.error ?? 'That did not work.' }
      : decision === 'DISCARDED' ? { text: 'Discarded.' }
        : { text: `${body.run?.mutationSummary ?? 'Dira ran it'} · ${label(body.run?.status ?? '')}`, workflowId: body.run?.id });
    setBusy('');
    await load();
  }

  if (!notes.length && !message) return null;
  return (
    <section className="panel" aria-labelledby="notes-title">
      <div className="section-label">From Hermes</div>
      <h2 id="notes-title">Changes you mentioned in chat</h2>
      {message && <p className="graph-notice" role="status">{message.text}{message.workflowId && <> · <Link href={`/activity?workflow=${encodeURIComponent(message.workflowId)}`}>See the run</Link></>}</p>}
      {notes.map((note) => (
        <article className="rule-card" key={note.noteId}>
          <p className="rule-sentence">“{note.text}”</p>
          <p className="muted">Relayed {new Date(note.createdAtIso).toLocaleString()}. Confirm to let Dira interpret it and plan a repair; it can only change your own commitments.</p>
          <div className="proposal-actions">
            <button className="btn" type="button" disabled={busy === note.noteId} onClick={() => void decide(note, 'CONFIRMED')}>Confirm and run</button>
            <button className="btn btn-secondary" type="button" disabled={busy === note.noteId} onClick={() => void decide(note, 'DISCARDED')}>Discard</button>
          </div>
        </article>
      ))}
    </section>
  );
}
