import { useState } from 'react';
import { post } from '../../api';
import { useAuth } from '../../auth';
import { useAction, useApi } from '../../hooks';
import { Button, Field, Input, Notice, Textarea, formValues } from '../../ui';
import { useToast } from '../../toast';
import type { Region } from '../../api';

export default function Apply() {
  const toast = useToast(); const { reload } = useAuth();
  const regions = useApi<Region[]>('/regions');
  const [picked, setPicked] = useState<string[]>([]);
  const a = useAction(async (v: Record<string, string>) => {
    await post('/vendor/apply', { ...v, regions: picked, contact_email: v.contact_email || undefined, description: v.description || undefined, legal_name: v.legal_name || undefined, business_number: v.business_number || undefined });
    toast('Application started. Finish the setup checklist to submit it.'); await reload();
  });
  return (
    <div className="wrap stack lg" style={{ maxWidth: 720, margin: '24px auto' }}>
      <div><h1>Sell on EAZyfoods</h1>
        <p className="muted">Showcase your African groceries online, take orders in one place, and manage stock and prices yourself. Customers find your store by region and product. EAZyfoods charges a commission on completed orders; the rate is shown in the vendor agreement. We cannot promise any amount of sales — results depend on your products, prices and availability.</p></div>
      <form className="panel" onSubmit={(e) => a.run(formValues(e))}>
        <h2>Tell us about your business</h2>
        {a.error && <Notice tone="error">{a.error}</Notice>}
        <div className="form-grid">
          <Field label="Business name"><Input name="business_name" required minLength={2} /></Field>
          <Field label="Legal name (optional)"><Input name="legal_name" /></Field>
          <Field label="Business / GST number (optional now)"><Input name="business_number" /></Field>
          <Field label="Phone"><Input name="phone" type="tel" required minLength={7} /></Field>
          <Field label="Contact email (optional)"><Input name="contact_email" type="email" /></Field>
          <Field label="Store name"><Input name="store_name" required minLength={2} /></Field>
          <Field label="Street address"><Input name="address_line" required minLength={3} /></Field>
          <Field label="City"><Input name="city" defaultValue="Calgary" required /></Field>
          <Field label="Postal code"><Input name="postal_code" required placeholder="T2A 0A0" /></Field>
        </div>
        <Field label="About your store (optional)"><Textarea name="description" maxLength={1000} /></Field>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}><legend className="label" style={{ fontWeight: 600, fontSize: '.9rem' }}>Regional specialties</legend>
          <div className="pill-list">{regions.data?.map((r) => (
            <label key={r.slug} className="check"><input type="checkbox" checked={picked.includes(r.slug)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.slug] : picked.filter((x) => x !== r.slug))} />{r.name}</label>))}</div></fieldset>
        <Button type="submit" size="lg" busy={a.busy}>Start application</Button>
      </form>
    </div>
  );
}
