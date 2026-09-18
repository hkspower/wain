import { Redirect, Stack, usePathname } from 'expo-router';

import { AdminShell } from '@/components/admin-shell';
import { ForcePasswordChange } from '@/components/backends-force-password-change';
import { useSession } from '@/lib/session';

/**
 * The guard for the whole panel.
 *
 * Signing out is not only something a manager does deliberately — a token that
 * the server has expired or revoked signs them out from under whatever screen
 * they were on. Without this redirect that screen simply stayed, showing an
 * empty list: the orders page with no orders looks exactly like a quiet
 * morning, which is the most misleading thing an admin panel can show.
 *
 * `ready` gates it, so a manager who IS signed in never sees the login flash
 * past while the stored token is being read.
 */
export default function BackendsLayout() {
  const { token, ready, mustChangePassword } = useSession();
  const pathname = usePathname();

  if (!ready) return <AdminShell title="" loading />;
  if (!token && pathname !== '/backends') return <Redirect href="/backends" />;
  // A temporary password from reset-admin-password.php: signed in, but every
  // OTHER route already 428s on the server. Rendered here rather than as its
  // own route so there is nothing to navigate to instead of it.
  if (token && mustChangePassword) return <ForcePasswordChange />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
