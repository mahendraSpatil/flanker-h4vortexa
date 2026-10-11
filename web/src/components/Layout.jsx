// Owner: Archit (frozen; ask before changing) | App shell: top nav + actor name (sent as X-Actor) + page outlet
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { getActor, setActor } from '../api/client.js';
import ChatbotWidget from './ChatbotWidget.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Upload', end: true },
  { to: '/records', label: 'Records' },
  { to: '/batches', label: 'Batches' },
  { to: '/audit', label: 'Audit' },
  { to: '/demo', label: 'Demo' },
];

function navClass({ isActive }) {
  const base = 'rounded-md px-3 py-1.5 text-sm font-medium';
  return isActive
    ? `${base} bg-slate-900 text-white`
    : `${base} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
}

function ActorInput() {
  const [actor, setActorState] = useState(getActor);
  const missing = actor.trim() === '';

  function handleChange(event) {
    setActorState(event.target.value);
    setActor(event.target.value);
  }

  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      Acting as
      <input
        value={actor}
        onChange={handleChange}
        placeholder="Your name (required to make changes)"
        maxLength={64}
        className={`w-56 rounded-md border px-2 py-1 text-slate-900 ${
          missing ? 'border-amber-400 bg-amber-50' : 'border-slate-300'
        }`}
      />
    </label>
  );
}

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold">ProofChain Registry</span>
            <nav className="flex gap-1">
              {NAV_ITEMS.map(({ to, label, end }) => (
                <NavLink key={to} to={to} end={end} className={navClass}>
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <ActorInput />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <ChatbotWidget />
    </div>
  );
}
