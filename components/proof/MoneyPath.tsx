import React from 'react';
import { clsx } from 'clsx';

/**
 * Where the money went, once the chain confirmed it: from node to node along a
 * rail that fills once, with the value travelling at its tip. Amber when it is a
 * prize (the only thing amber marks besides the main button), green when it is a
 * payment a proven delivery released. Only ever shown for a confirmed fact.
 */
export function MoneyPath({
  nodes,
  tone,
  animate = true,
  className,
}: {
  nodes: readonly { label: string; detail?: React.ReactNode }[];
  tone: 'prize' | 'proof';
  animate?: boolean;
  className?: string;
}) {
  const ink = tone === 'prize' ? 'bg-brand' : 'bg-success';
  // One leg after the other: each rail fills in 1.4 s, the node it reaches lands as it arrives.
  const leg = (index: number) => 200 + (index - 1) * 1300;
  return (
    <ol className={clsx('flex items-start', className)}>
      {nodes.map((node, index) => (
        <React.Fragment key={node.label}>
          {index > 0 && (
            <li aria-hidden="true" className="relative mt-[7px] h-px min-w-6 flex-1 bg-dark-line">
              <span
                className={clsx('absolute inset-0 origin-left', ink, animate && 'iw-path-fill')}
                style={animate ? { animationDelay: `${leg(index)}ms` } : undefined}
              />
              {animate && (
                <span className="iw-path-runner absolute inset-0" style={{ animationDelay: `${leg(index)}ms` }}>
                  <span className={clsx('absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full shadow-[0_0_12px_2px_currentColor]', ink, tone === 'prize' ? 'text-brand/50' : 'text-success/50')} />
                </span>
              )}
            </li>
          )}
          <li
            className={clsx('flex min-w-0 max-w-[9rem] flex-col items-center gap-1.5 text-center', animate && 'iw-path-node')}
            style={animate ? { animationDelay: `${index === 0 ? 0 : leg(index) + 1100}ms` } : undefined}
          >
            <span aria-hidden="true" className={clsx('h-[15px] w-[15px] rounded-full border-2 border-black ring-1', index === 0 ? 'bg-dark-line ring-dark-line' : clsx(ink, tone === 'prize' ? 'ring-brand/40' : 'ring-success/40'))} />
            <span className="text-xs font-medium text-gray-200">{node.label}</span>
            {node.detail && <span className="min-w-0 max-w-full text-xs text-gray-400">{node.detail}</span>}
          </li>
        </React.Fragment>
      ))}
    </ol>
  );
}
