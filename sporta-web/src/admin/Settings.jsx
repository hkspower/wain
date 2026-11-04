// The Settings tab: two read-only notes. A screen of its own (and so its own
// chunk, like the rest) rather than markup inside AdminApp, which is now only
// the shell around them.
export default function Settings() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Settings</h1>

      <div className="rounded-2xl border border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-800">Your sign-in</p>
        <p className="mt-2">
          Email and password, created on the server. To change the password, clear the{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">admin_users</code> table in
          phpMyAdmin and run{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">api/setup-admin.php</code>{' '}
          again — then delete that file. Five wrong passwords lock the account for fifteen
          minutes.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-800">Product photos</p>
        <p className="mt-2">
          Photos ship with the site. Upload new ones into{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">public_html/cats/</code> in
          hPanel File Manager and reference them from the catalogue. Brand logos are the
          exception — those live in the database and are uploaded on the Brands tab, because
          nothing on this server may write files.
        </p>
      </div>
    </div>
  )
}
