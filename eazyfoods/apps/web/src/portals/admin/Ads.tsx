import { useState } from 'react';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Field, Modal, Notice, PageHeader, StatusBadge, Textarea } from '../../ui';
import { DataTable, Fetch, Need, cents, patch } from './common';

export function Ads() {
  const toast = useToast();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const act = useAction(async (id: string, status: string, n: string | undefined, reload: () => void) => { await patch(`/admin/ads/${id}`, { status, note: n }); toast(`Campaign ${status}`); reload(); });
  return (
    <Need perm={['ads.manage']} what="managing advertising">
      <PageHeader title="Advertising" sub="Review creative before it goes live. Impressions, clicks and spend below are counted by EAZyfoods. We make no claim about effect on sales." />
      {act.error && <Notice tone="error">{act.error}</Notice>}
      <Fetch path="/admin/ads">{(rows: any[], reload) => (
        <>
          <DataTable rows={rows} rowKey={(r) => r.id} empty="No campaigns yet."
            columns={[
              { key: 't', header: 'Campaign', render: (r) => <><strong>{r.title}</strong><div className="small muted">{r.vendor_name}{r.product_name ? ` · ${r.product_name}` : ''}</div>{r.body && <div className="small">{r.body}</div>}{r.image_url && <img src={r.image_url} alt="" style={{ width: 90, borderRadius: 6, marginTop: 4 }} />}</> },
              { key: 'p', header: 'Placement', render: (r) => <Badge tone="info">{r.placement.replace(/_/g, ' ')}</Badge> },
              { key: 'd', header: 'Dates', render: (r) => `${fmtDate(r.starts_at, { dateStyle: 'medium' })} to ${fmtDate(r.ends_at, { dateStyle: 'medium' })}` },
              { key: 'b', header: 'Budget', render: (r) => <>{cents(r.budget_cents)}<div className="small muted">{cents(r.cpc_cents)} per click</div></> },
              { key: 'm', header: 'Measured', render: (r) => <span className="small">{r.impressions} impressions · {r.clicks} clicks · {cents(r.spent_cents)} spent</span> },
              { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'a', header: '', render: (r) => (
                <div className="row wrap">
                  {r.status !== 'approved' && <Button size="sm" onClick={() => act.run(r.id, 'approved', undefined, reload)}>Approve</Button>}
                  {r.status === 'approved' && <Button size="sm" variant="secondary" onClick={() => act.run(r.id, 'paused', undefined, reload)}>Pause</Button>}
                  {r.status !== 'rejected' && <Button size="sm" variant="danger" onClick={() => { setRejecting(r.id); setNote(''); }}>Reject</Button>}
                </div>) },
            ]} />
          <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject campaign">
            <Field label="Tell the vendor why (required)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="row end"><Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
              <Button variant="danger" disabled={note.length < 3} onClick={async () => { await act.run(rejecting!, 'rejected', note, reload); setRejecting(null); }}>Reject</Button></div>
          </Modal>
        </>
      )}</Fetch>
    </Need>
  );
}
