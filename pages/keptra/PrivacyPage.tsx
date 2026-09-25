import { useEffect } from 'react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { Notice, PageTitle } from '../../components/keptra/ui';
import { PRIVACY_TEXT, privacyPublished } from '../../lib/keptra/privacy';

/*
 * /privacy — a route of the app, with the owner's text (10.4, T14). Until the
 * text exists the page says so, and the address forms stay locked
 * (components/keptra/AddressForm.tsx).
 *
 * The owner's words are shown exactly as written; only their typography is set
 * here, from the text's own structure: the first block is the notice's name,
 * every other block opens with its heading, a line starting with "- " is a list
 * item (the dash becomes the list's marker), and a list item that opens with a
 * short label and a colon has that label set in bold.
 */

type Line = { kind: 'para'; text: string } | { kind: 'list'; items: string[] };
interface Block {
  readonly heading: string;
  readonly id: string;
  readonly lines: Line[];
}

function parse(text: string): { name: string; blocks: Block[] } {
  const [first, ...rest] = text.trim().split(/\n\s*\n/);
  const blocks = rest.map((raw) => {
    const [heading, ...body] = raw.split('\n').map((line) => line.trimEnd());
    const lines: Line[] = [];
    for (const line of body) {
      if (line.startsWith('- ')) {
        const last = lines[lines.length - 1];
        if (last?.kind === 'list') last.items.push(line.slice(2));
        else lines.push({ kind: 'list', items: [line.slice(2)] });
      } else if (line.trim().length > 0) lines.push({ kind: 'para', text: line });
    }
    return { heading, id: heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), lines };
  });
  return { name: first.trim(), blocks };
}

/** "Delivery address: collected when…" → the label in bold, the rest as written. */
function Item({ text }: { text: string }) {
  const colon = text.indexOf(':');
  if (colon > 0 && colon <= 32) {
    return (
      <>
        <strong className="font-semibold text-white">{text.slice(0, colon + 1)}</strong>
        {text.slice(colon + 1)}
      </>
    );
  }
  return <>{text}</>;
}

export function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacy · Keptra';
  }, []);
  const notice = privacyPublished() ? parse(PRIVACY_TEXT) : null;
  return (
    <KeptraShell>
      <PageTitle eyebrow="Keptra" title="Privacy" />
      {notice ? (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <article className="max-w-3xl">
            <p className="font-display text-xl font-bold tracking-wide text-gray-300">{notice.name}</p>
            {notice.blocks.map((block) => (
              <section key={block.id} aria-labelledby={block.id} className="mt-10 border-t border-dark-border pt-8 first-of-type:mt-8">
                <h2 id={block.id} className="scroll-mt-28 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  {block.heading}
                </h2>
                <div className="mt-4 space-y-4 text-base leading-relaxed text-gray-300">
                  {block.lines.map((line, index) =>
                    line.kind === 'para' ? (
                      <p key={index} className="max-w-[68ch]">
                        {line.text}
                      </p>
                    ) : (
                      <ul key={index} className="max-w-[68ch] space-y-3">
                        {line.items.map((item) => (
                          <li key={item.slice(0, 40)} className="relative pl-5 before:absolute before:left-0 before:top-[0.7em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-gray-500">
                            <Item text={item} />
                          </li>
                        ))}
                      </ul>
                    ),
                  )}
                </div>
              </section>
            ))}
          </article>
          {/* The notice's sections, to jump to: on the computer, beside the text. */}
          <nav aria-label="Sections" className="hidden lg:block">
            <ul className="sticky top-28 space-y-1 border-l border-dark-border pl-4 text-sm">
              {notice.blocks.map((block) => (
                <li key={block.id}>
                  <a href={`#${block.id}`} className="inline-flex min-h-[32px] items-center text-gray-400 transition-colors duration-200 hover:text-white">
                    {block.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : (
        <Notice title="Not published yet">
          Keptra's privacy notice is being prepared. Until it is published, Keptra does not ask for any delivery address.
        </Notice>
      )}
    </KeptraShell>
  );
}

