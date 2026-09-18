import { Redirect, Stack, usePathname } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { AdminChrome } from '@/components/admin-shell';
import { ForcePasswordChange } from '@/components/backends-force-password-change';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/**
 * The guard for the whole panel, and the one place its chrome — header,
 * sign-out, nav — is mounted. Every screen used to carry its own copy of all
 * three, which meant expo-router tore the whole thing down and rebuilt it on
 * every navigation; see AdminChrome's own comment for what that cost. Wrapping
 * the Stack here instead means a tap only ever swaps what is under a header
 * and nav that never left the screen.
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
  const theme = useTheme();

  // BEFORE useSession HAS ANSWERED, token is unknown either way, so there is
  // nothing for AdminChrome's nav to show and no chrome worth mounting yet.
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.tint} />
      </View>
    );
  }
  if (!token && pathname !== '/backends') return <Redirect href="/backends" />;

  return (
    <AdminChrome hideNav={!!(token && mustChangePassword)}>
      {/* A temporary password from reset-admin-password.php: signed in, but
          every OTHER route already 428s on the server. Rendered here rather
          than as its own route so there is nothing to navigate to instead
          of it, and hideNav above keeps the dead-end nav off it. */}
      {token && mustChangePassword ? (
        <ForcePasswordChange />
      ) : (
        // ANIMATION 'none': the transition itself was part of "switching
        // pages feels slow" — a slide/fade on top of a chrome that used to
        // also be rebuilding had no reason to exist once the chrome stopped
        // moving. The content still changes the instant a nav item is
        // pressed.
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      )}
    </AdminChrome>
  );
}
