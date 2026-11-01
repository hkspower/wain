import { Component } from 'react'

// A failed lazy page import must leave a usable recovery screen, not an empty
// root. This also covers visitors holding an older page during a deployment.
export default class SiteErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // The recovery view is a successful paint too. Keep the boot watchdog
    // from covering it when the app failed before Mounted could commit.
    window.__SPORTA_MOUNTED = true
  }

  render() {
    if (!this.state.failed) return this.props.children
    const ar = document.documentElement.lang === 'ar'
    return (
      <main role="alert" dir={ar ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', padding: '2rem', background: 'var(--canvas, #fff)', color: 'var(--text-primary, #171a1e)', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{ar ? 'تعذّر تحميل الصفحة' : 'This page could not load'}</h1>
        <p style={{ marginBlock: '1rem', maxWidth: '32rem' }}>{ar ? 'حدّث الصفحة للمحاولة مرة أخرى.' : 'Reload the page to try again.'}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ borderRadius: '.75rem', padding: '.8rem 1.5rem', background: 'var(--brand-bright, #d28a69)', color: '#171a1e', fontWeight: 700 }}>
          {ar ? 'إعادة تحميل الصفحة' : 'Reload page'}
        </button>
        <a href="/" style={{ marginBlockStart: '1rem', textDecoration: 'underline' }}>{ar ? 'الصفحة الرئيسية' : 'Back to home'}</a>
      </main>
    )
  }
}
