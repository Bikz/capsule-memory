import { Link } from 'react-router-dom';

import logo from '@/client/assets/modelence.svg';

const DOCS_URL = 'https://docs.modelence.com';
const GITHUB_URL = 'https://github.com/modelence-labs/capsule-memory';

const features = [
  {
    title: 'Adaptive Retrieval',
    description:
      'Blend embeddings, rewriting, rerankers, and metadata-aware scoring in programmable recipes that ship straight to production.'
  },
  {
    title: 'Capture & Governance',
    description:
      'Automatically score conversation events, review high-confidence candidates, and enforce retention/ACL policies in one queue.'
  },
  {
    title: 'Capsule Studio',
    description:
      'Preview recipes, tune storage policies, and triage capture candidates without leaving your browser or MCP host.'
  }
];

const highlights = [
  {
    label: 'Getting started',
    text: 'Open Capsule Memory',
    to: '/memory'
  },
  {
    label: 'Operational console',
    text: 'Launch Capsule Studio',
    to: '/studio'
  }
];

export default function HomePage(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Navigation */}
      <header className="border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="Capsule Memory" className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-wide text-slate-100">Capsule Memory</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-slate-900 hover:text-white"
            >
              Docs
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-slate-900 hover:text-white"
            >
              GitHub
            </a>
            <Link
              to="/memory"
              className="inline-flex items-center rounded-lg bg-indigo-500 px-3 py-2 font-semibold text-slate-950 transition hover:bg-indigo-400"
            >
              Open Console
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-16 sm:py-24">
        {/* Hero */}
        <section className="grid items-center gap-12 md:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs uppercase tracking-widest text-slate-400">
              Memory-as-a-Service
            </span>
            <h1 className="text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
              Ship adaptive memory experiences in minutes, not weeks.
            </h1>
            <p className="max-w-xl text-lg text-slate-300">
              Capsule Memory is the programmable, governance-first memory layer for AI products. Deploy adaptive retrieval,
              capture, and policy tooling without leaving your stack.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/memory"
                className="inline-flex items-center rounded-lg bg-indigo-500 px-5 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-indigo-500/40 transition hover:bg-indigo-400"
              >
                Explore the platform
              </Link>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-lg border border-slate-700 px-5 py-3 text-base font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Read the docs
              </a>
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-slate-400">
              {highlights.map((item) => (
                <Link
                  key={item.text}
                  to={item.to}
                  className="group flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 transition hover:border-indigo-500 hover:text-white"
                >
                  <span className="font-semibold text-slate-200 group-hover:text-white">{item.text}</span>
                  <span aria-hidden className="text-indigo-400 group-hover:text-indigo-300">→</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 p-8 text-sm text-slate-200 shadow-2xl shadow-slate-900/60">
            <div className="absolute -left-16 -top-16 h-32 w-32 rounded-full bg-indigo-500/30 blur-3xl" aria-hidden />
            <div className="absolute -bottom-20 -right-10 h-36 w-36 rounded-full bg-purple-500/20 blur-3xl" aria-hidden />
            <div className="relative space-y-4">
              <p className="font-mono text-xs uppercase tracking-widest text-indigo-300/80">CAPTURE QUEUE</p>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-4">
                  <p className="text-xs text-slate-400">candidate</p>
                  <p className="text-sm font-semibold text-white">“Call me Lex during future conversations.”</p>
                  <p className="mt-2 text-xs text-emerald-300">score 0.85 — recommended</p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-4">
                  <p className="text-xs text-slate-400">policy</p>
                  <p className="text-sm text-slate-200">Retention → irreplaceable • TTL → none • Store → long-term</p>
                </div>
              </div>
              <Link
                to="/studio"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-indigo-500 hover:text-white"
              >
                Manage in Capsule Studio →
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="space-y-8">
          <h2 className="text-2xl font-semibold text-white">Why teams choose Capsule Memory</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-lg shadow-slate-900/30 transition hover:border-indigo-500/80"
              >
                <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                <p className="mt-3 text-sm text-slate-300">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-3xl border border-slate-800 bg-gradient-to-r from-indigo-500/20 via-purple-500/10 to-slate-900/80 p-10 shadow-xl shadow-slate-900/40">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-widest text-indigo-300/90">Ready to memory-enable your AI product?</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Start capturing and retrieving within minutes.</h3>
              <p className="mt-2 max-w-2xl text-slate-200">
                Install the SDKs, connect your ingestion sources, and let Capsule handle adaptive retrieval, capture scoring,
                and governance—whether you deploy locally or in the cloud.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                to="/memory"
                className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-5 py-3 text-base font-semibold text-emerald-950 transition hover:bg-emerald-400"
              >
                Launch Capsule Memory →
              </Link>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg border border-slate-200/40 px-5 py-3 text-base font-semibold text-white transition hover:border-white"
              >
                View quickstart guide
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/70 bg-slate-950">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Capsule Labs. Built with Modelence.</span>
          <div className="flex items-center gap-4">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-white"
            >
              Documentation
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-white"
            >
              GitHub
            </a>
            <Link to="/studio" className="transition hover:text-white">
              Capsule Studio
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
