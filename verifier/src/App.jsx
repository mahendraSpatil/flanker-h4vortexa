// Owner: Neel | Verifier page (placeholder): pinned registry + chain status; drop zones and checks come next
import { useEffect, useState } from 'react';
import { getBlockNumber } from './chain.js';
import { PINNED } from './config.js';

const POLL_MS = 5000;

function useChainStatus() {
  const [status, setStatus] = useState({ state: 'checking', blockNumber: null });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const blockNumber = await getBlockNumber();
        if (!cancelled) setStatus({ state: 'up', blockNumber });
      } catch {
        if (!cancelled) setStatus({ state: 'down', blockNumber: null });
      }
    }
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return status;
}

const STATUS_STYLE = {
  checking: 'bg-slate-100 text-slate-600',
  up: 'bg-emerald-100 text-emerald-800',
  down: 'bg-red-100 text-red-800',
};

export default function App() {
  const chain = useChainStatus();
  const label = {
    checking: 'Checking chain...',
    up: `Chain reachable (block ${chain.blockNumber})`,
    down: `Chain unreachable at ${PINNED.rpcUrl}`,
  }[chain.state];

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 text-slate-900">
      <h1 className="text-3xl font-semibold">ProofChain Verifier</h1>
      <p className="mt-2 text-slate-600">
        Checks a document and its proof.json against the root on the pinned contract. It never talks
        to the registry.
      </p>
      <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dt className="text-slate-500">Pinned contract</dt>
        <dd className="font-mono break-all">{PINNED.contract}</dd>
        <dt className="text-slate-500">Chain ID</dt>
        <dd className="font-mono">{PINNED.chainId}</dd>
        <dt className="text-slate-500">Status</dt>
        <dd>
          <span className={`rounded px-2 py-0.5 ${STATUS_STYLE[chain.state]}`}>{label}</span>
        </dd>
      </dl>
    </main>
  );
}
