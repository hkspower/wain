import { lazy, Suspense, useState } from 'react'
import { useLang } from '../i18n/LanguageContext'

// The launcher, and the ONLY part of سبورتا AI that ships in the main bundle.
//
// A button and a boolean. The panel — the conversation, the order card, the
// product list — is a separate chunk that arrives on the first click, because
// the home page has about 3 kB of image budget left and a chat window most
// visitors never open has no claim on it. The measurement is in the commit;
// the rule is that nothing here may grow into the panel.
const AssistantPanel = lazy(() => import('./AssistantPanel'))

export default function Assistant() {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const T = t.assistant

  return (
    <>
      {open && (
        // No fallback. The chunk is ~4 kB and arrives in a blink on any
        // connection that loaded the shop; a spinner appearing and vanishing
        // is more noticeable than the wait it describes.
        <Suspense fallback={null}>
          <AssistantPanel onClose={() => setOpen(false)} />
        </Suspense>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={T.open}
        // bottom-4 end-4: the end side, so it moves to the left in Arabic
        // rather than sitting over the text. print:hidden because an invoice
        // printed from /invoice should not carry a chat button.
        className="tap-target fixed bottom-4 z-50 flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-bold text-white shadow-xl end-4 print:hidden"
      >
        <img src="/favicon-192.png" alt="" width="192" height="192" className="h-5 w-5" />
        <span className="hidden sm:inline">{T.title}</span>
      </button>
    </>
  )
}
