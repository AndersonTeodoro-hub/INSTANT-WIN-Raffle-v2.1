import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { registerAddress, type PostalAddress } from '../../lib/keptra/api';
import { countryName } from '../../lib/keptra/format';
import { privacyPublished } from '../../lib/keptra/privacy';
import { Button, Field, Notice, inputClass } from './ui';

/*
 * The delivery address, before paying (COMPRA) or redeeming (PRÉMIO). Section 10,
 * P15, P19, H7, T14.
 *
 * - The fields of P19; the country is chosen among the ones the store or the brand
 *   accepts, read from the chain (P15, 11.5) — the bridge refuses any other.
 * - T14: locked until the privacy page has its text (10.4).
 * - Sent to the bridge, stored encrypted there, and forgotten here (I7, 10.2).
 */

const EMPTY = { name: '', street: '', postCode: '', city: '', phone: '' };

export function AddressForm({
  purpose,
  regions,
  onRegistered,
}: {
  purpose: { termsId: string } | { voucherId: string };
  regions: readonly string[];
  onRegistered: () => void;
}) {
  const [fields, setFields] = useState(EMPTY);
  const [country, setCountry] = useState(regions.length === 1 ? regions[0] : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!privacyPublished()) {
    return (
      <Notice tone="warning" title="Delivery addresses open soon">
        <p className="flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Keptra asks for an address only once its privacy page is published, so you can read how it is kept and when it is erased. See the{' '}
            <Link to="/privacy" className="underline underline-offset-4">
              privacy page
            </Link>
            .
          </span>
        </p>
      </Notice>
    );
  }

  const set = (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: event.target.value });

  const submit = async () => {
    setError(null);
    if (!fields.name.trim() || !fields.street.trim() || !fields.postCode.trim() || !fields.city.trim()) return setError('Fill in the name, street, post code and city.');
    if (!regions.includes(country)) return setError('Choose the country the order is delivered to.');
    const address: PostalAddress = {
      name: fields.name.trim(),
      street: fields.street.trim(),
      postCode: fields.postCode.trim(),
      city: fields.city.trim(),
      country,
      phone: fields.phone.trim() === '' ? null : fields.phone.trim(),
    };
    setBusy(true);
    const result = await registerAddress(purpose, address);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setFields(EMPTY);
    onRegistered();
  };

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="sm:col-span-2">
        <Field id="addr-name" label="Full name">
          <input id="addr-name" autoComplete="name" className={inputClass} value={fields.name} onChange={set('name')} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field id="addr-street" label="Street and number">
          <input id="addr-street" autoComplete="street-address" className={inputClass} value={fields.street} onChange={set('street')} />
        </Field>
      </div>
      <Field id="addr-post" label="Post code">
        <input id="addr-post" autoComplete="postal-code" className={inputClass} value={fields.postCode} onChange={set('postCode')} />
      </Field>
      <Field id="addr-city" label="City">
        <input id="addr-city" autoComplete="address-level2" className={inputClass} value={fields.city} onChange={set('city')} />
      </Field>
      <Field id="addr-country" label="Country" hint="Only the countries this offer delivers to.">
        <select id="addr-country" className={inputClass} value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="">Choose…</option>
          {regions.map((code) => (
            <option key={code} value={code}>
              {countryName(code)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="addr-phone" label="Phone for the carrier (optional)">
        <input id="addr-phone" type="tel" autoComplete="tel" className={inputClass} value={fields.phone} onChange={set('phone')} />
      </Field>
      {error && (
        <div className="sm:col-span-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="sm:col-span-2">
        <p className="mb-3 text-xs text-gray-400">
          Stored encrypted and read only by the store of this order. Never written on-chain, and erased within 30 days of the order ending.
        </p>
        <Button type="submit" busy={busy}>
          Save delivery address
        </Button>
      </div>
    </form>
  );
}
