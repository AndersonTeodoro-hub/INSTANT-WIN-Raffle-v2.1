import { useEffect } from 'react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { Notice, PageTitle } from '../../components/keptra/ui';
import { PRIVACY_TEXT, privacyPublished } from '../../lib/keptra/privacy';

/*
 * /privacy — a route of the app, with the owner's text (10.4, T14). Until the
 * text exists the page says so, and the address forms stay locked
 * (components/keptra/AddressForm.tsx).
 */
export function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacy · Keptra';
  }, []);
  return (
    <KeptraShell>
      <PageTitle eyebrow="Keptra" title="Privacy" />
      {privacyPublished() ? (
        <article className="max-w-3xl space-y-4 text-base leading-relaxed text-gray-200">
          {PRIVACY_TEXT.trim()
            .split(/\n\s*\n/)
            .map((paragraph) => (
              <p key={paragraph.slice(0, 40)} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
        </article>
      ) : (
        <Notice title="Not published yet">
          Keptra's privacy notice is being prepared. Until it is published, Keptra does not ask for any delivery address.
        </Notice>
      )}
    </KeptraShell>
  );
}
