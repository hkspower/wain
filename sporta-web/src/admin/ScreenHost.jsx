import { Component, Suspense } from 'react'
import { screenFor, retryScreen } from './screens'

// Hosts one admin screen: loads its chunk, holds a placeholder of a fixed
// minimum height while it travels, and turns a failed load into a button.
//
// WHY THE PLACEHOLDER HAS A HEIGHT
// The screen below the shell's header is the only thing that changes when a tab
// opens. A placeholder as tall as its text would collapse the content area and
// the page would jump twice: once to the placeholder, once to the screen. 70vh
// holds the area open until the screen arrives, and the skeleton inside it
// mirrors the shape every screen starts with (a title, a line, then blocks).
export function ScreenFallback({ label }) {
  return (
    <div className="admin-screen-fallback min-h-[70vh] space-y-5" role="status" aria-busy="true">
      <span className="sr-only">Loading {label}…</span>
      <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
        <div>
          <div className="h-8 w-44 rounded bg-slate-200" />
          <div className="mt-2 h-4 w-28 rounded bg-slate-100" />
        </div>
        <div className="h-11 w-full max-w-md rounded-lg bg-slate-100" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  )
}

// What the browsers call a chunk that did not arrive. Chrome and Firefox say
// "dynamically imported module"; Safari says "Importing a module script
// failed"; webpack-style loaders throw a ChunkLoadError.
const CHUNK_FAILED = /dynamically imported module|importing a module script failed|ChunkLoadError/i
const isChunkError = (e) => CHUNK_FAILED.test(`${e?.name ?? ''} ${e?.message ?? ''}`)

function ScreenError({ label, chunk, tries, onRetry }) {
  return (
    <div className="admin-screen-error min-h-[40vh]" role="alert">
      <div className="max-w-xl rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-900">
        <p className="font-bold">{chunk ? `${label} could not be loaded` : `${label} stopped working`}</p>
        <p className="mt-1 text-sm leading-relaxed">
          {chunk
            ? 'The screen’s code did not arrive. This is usually a dropped connection, or the site was updated while this page was open. If Try again does nothing, reload the page.'
            : 'Something went wrong while drawing this screen. Nothing was saved or lost on the server.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Try again
          </button>
          {/* A second failure means this page is probably stale (the chunk's
              hashed name changed in a deploy): only a reload fetches the new
              index. */}
          {(tries > 0 || chunk) && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-11 rounded-lg border border-[#7d8799] bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Reload the page
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

class ScreenBoundary extends Component {
  state = { error: null, tries: 0 }

  static getDerivedStateFromError(error) {
    return { error }
  }

  // Leaving a screen that failed and coming back later is a fresh attempt.
  componentWillUnmount() {
    if (this.state.error) retryScreen(this.props.id)
  }

  retry = () => {
    retryScreen(this.props.id)
    this.setState((s) => ({ error: null, tries: s.tries + 1 }))
  }

  render() {
    const { error, tries } = this.state
    if (error) {
      return <ScreenError label={this.props.label} chunk={isChunkError(error)} tries={tries} onRetry={this.retry} />
    }
    return this.props.children
  }
}

// Looks the component up while rendering, not in the parent: after "Try again"
// the boundary re-mounts THIS component, which then asks for the screen's new
// lazy component. A parent that captured the old one would throw the same
// rejected promise again.
function LazyScreen({ id, screenProps }) {
  const Screen = screenFor(id)
  return <Screen {...screenProps} />
}

export default function ScreenHost({ id, label, screenProps }) {
  return (
    <ScreenBoundary id={id} label={label}>
      <Suspense fallback={<ScreenFallback label={label} />}>
        <LazyScreen id={id} screenProps={screenProps} />
      </Suspense>
    </ScreenBoundary>
  )
}
