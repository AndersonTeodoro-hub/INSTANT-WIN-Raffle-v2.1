import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { registerAddress, type PostalAddress } from '../../lib/keptra/api';
import { countryName } from '../../lib/keptra/format';
import { privacyPublished } from '../../lib/keptra/privacy';
import { Button, Field, Notice, inputClass } from './ui';
import { around, useKeptraCopy } from '../../pages/keptra.i18n';

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
  const { t, lang, say } = useKeptraCopy();

  if (!privacyPublished()) {
    const [before, after] = around(t.address.lockedBody, 'link');
    return (
      <Notice tone="warning" title={t.address.lockedTitle}>
        <p className="flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {before}
            <Link to="/privacy" className="underline underline-offset-4">
              {t.address.privacyLink}
            </Link>
            {after}
          </span>
        </p>
      </Notice>
    );
  }

  const set = (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: event.target.value });

  const submit = async () => {
    setError(null);
    if (!fields.name.trim() || !fields.street.trim() || !fields.postCode.trim() || !fields.city.trim()) return setError(t.address.missingFields);
    if (!regions.includes(country)) return setError(t.address.chooseCountry);
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
    if (!result.ok) return setError(say(result.error));
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
        <Field id="addr-name" label={t.address.name}>
          <input id="addr-name" autoComplete="name" className={inputClass} value={fields.name} onChange={set('name')} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field id="addr-street" label={t.address.street}>
          <input id="addr-street" autoComplete="street-address" className={inputClass} value={fields.street} onChange={set('street')} />
        </Field>
      </div>
      <Field id="addr-post" label={t.address.postCode} hint={t.address.postCodeHint}>
        <input id="addr-post" autoComplete="postal-code" className={inputClass} value={fields.postCode} onChange={set('postCode')} />
      </Field>
      <Field id="addr-city" label={t.address.city}>
        <input id="addr-city" autoComplete="address-level2" className={inputClass} value={fields.city} onChange={set('city')} />
      </Field>
      <Field id="addr-country" label={t.address.country} hint={t.address.countryHint}>
        <select id="addr-country" className={inputClass} value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="">{t.address.choose}</option>
          {regions.map((code) => (
            <option key={code} value={code}>
              {countryName(code, lang)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="addr-phone" label={t.address.phone}>
        <input id="addr-phone" type="tel" autoComplete="tel" className={inputClass} value={fields.phone} onChange={set('phone')} />
      </Field>
      {error && (
        <div className="sm:col-span-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="sm:col-span-2">
        <p className="mb-3 text-xs text-gray-400">{t.address.storedNote}</p>
        <Button type="submit" busy={busy}>
          {t.address.save}
        </Button>
      </div>
    </form>
  );
}
