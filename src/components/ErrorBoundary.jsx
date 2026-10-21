import { Component } from 'react';
import { clearDraft } from '../lib/draft.js';
import { DICT } from '../lib/dict.js';

// No hooks/context here on purpose: the boundary must work even if the provider tree is what crashed.
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  restart = () => {
    clearDraft(); // a corrupted draft is the most likely cause; settings stay untouched
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const d = document.documentElement.lang === 'en' ? DICT.en : DICT.es;
    return (
      <main role="alert" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 text-center">
        <h1 className="text-2xl font-extrabold">{d['err.title']}</h1>
        <p className="mb-6 mt-2 text-neutral-300">{d['err.body']}</p>
        <button
          type="button"
          onClick={this.restart}
          className="min-h-[52px] rounded-xl bg-brand px-5 font-bold text-black"
        >
          {d['err.reload']}
        </button>
      </main>
    );
  }
}
