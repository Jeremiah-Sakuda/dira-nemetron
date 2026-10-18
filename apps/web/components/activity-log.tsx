'use client';

import { useEffect, useState } from 'react';
import { FlightTimeline, type FlightLine } from './flight-timeline';
import { formatSlack, label, readJson } from '../lib/format';

interface WorkflowSummary {
  id: string; kind: string; status: string; statusReason?: string; mutationSummary?: string;
  slackBeforeMin?: number; slackAfterMutationMin?: number; slackFinalMin?: number; failuresRecovered: number; replans: number;
}
interface ActionRow { actionId: string; type: string; summary: string; status: string; policyVerdict: string; externalSystem: string; verifiedAtIso?: string; approval?: { decision?: string; source?: string } }

export function ActivityLog() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [detail, setDetail] = useState<{ workflowId:string; flight: FlightLine[]; actions: ActionRow[] } | null>(null);
  const [error, setError] = useState('');
  const [detailError,setDetailError]=useState('');
  const [loaded,setLoaded]=useState(false);
  const [retry,setRetry]=useState(0);
  const [detailRetry,setDetailRetry]=useState(0);

  useEffect(() => {
    let cancelled=false; setLoaded(false);setError('');
    void (async () => {
      const response=await fetch('/api/workflows',{cache:'no-store'});
      const body=await readJson<{workflows:WorkflowSummary[]}>(response);
      if(!response.ok)throw Error(body.error ?? 'Activity could not be loaded.');
      if(cancelled)return;
      setWorkflows(body.workflows);setLoaded(true);
      const fromUrl=new URLSearchParams(window.location.search).get('workflow');
      setSelected(current=>body.workflows.some(run=>run.id===current)?current:body.workflows.some(run=>run.id===fromUrl)?fromUrl!:body.workflows[0]?.id ?? '');
    })().catch(cause=>{if(!cancelled)setError(cause instanceof Error?cause.message:'Activity unavailable');});
    return ()=>{cancelled=true;};
  },[retry]);
  useEffect(()=>{
    let cancelled=false;setDetail(null);setDetailError('');
    if(!selected)return ()=>{cancelled=true;};
    void (async()=>{
      const response=await fetch(`/api/workflows/${encodeURIComponent(selected)}`,{cache:'no-store'});
      const body=await readJson<{flight:FlightLine[];actions:ActionRow[]}>(response);
      if(!response.ok)throw Error(body.error ?? 'Selected run details are unavailable.');
      if(!cancelled)setDetail({...body,workflowId:selected});
    })().catch(cause=>{if(!cancelled)setDetailError(cause instanceof Error?cause.message:'Run details unavailable');});
    return ()=>{cancelled=true;};
  },[selected,detailRetry]);

  if (error) return <section className="panel"><p className="form-error" role="alert">{error}</p><button className="btn" onClick={()=>setRetry(value=>value+1)}>Retry activity</button></section>;
  if (!loaded) return <p role="status">Loading activity…</p>;
  if (!workflows.length) return <section className="panel"><p className="muted">No runs yet. Repairs appear here when an email, calendar change or feed update affects your commitments.</p></section>;

  return (
    <div className="activity-layout">
      <nav className="panel activity-list" aria-label="Runs">
        {workflows.map((run) => (
          <button key={run.id} type="button" className={run.id === selected ? 'activity-item active' : 'activity-item'} onClick={() => setSelected(run.id)}>
            <strong>{run.mutationSummary ?? label(run.kind)}</strong>
            <span className="muted">{label(run.status)} · slack {formatSlack(run.slackAfterMutationMin)} → {formatSlack(run.slackFinalMin)}{run.failuresRecovered ? ` · ${run.failuresRecovered} failure recovered` : ''}</span>
          </button>
        ))}
      </nav>
      <section className="panel activity-detail" aria-live="polite">
        {detailError ? <><p className="form-error" role="alert">{detailError}</p><button className="btn" onClick={()=>setDetailRetry(value=>value+1)}>Retry selected run</button></> : !detail || detail.workflowId !== selected ? <p className="muted" role="status">Loading selected run…</p> : (
          <>
            <h2>Actions</h2>
            <div className="ledger-table" role="table" aria-label="Action ledger">
              {detail.actions.map((action) => (
                <div className="ledger-row" role="row" key={action.actionId}>
                  <span role="cell" className={`verdict verdict-${action.policyVerdict.toLowerCase()}`}>{label(action.policyVerdict)}</span>
                  <span role="cell">{action.summary}</span>
                  <span role="cell" className="muted">{label(action.status)}{action.approval?.decision ? ` · ${label(action.approval.decision)} via ${action.approval.source === 'telegram-callback' ? 'Telegram' : 'web'}` : ''}</span>
                </div>
              ))}
            </div>
            <h2>Flight record</h2>
            <FlightTimeline lines={detail.flight} />
          </>
        )}
      </section>
    </div>
  );
}
