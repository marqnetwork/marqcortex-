/**
 * What an authenticated route shows while the session is still being restored.
 *
 * Session restore runs in an effect, so on the first render nothing is known
 * about whether anyone is signed in. A guard that treats "not known yet" as
 * "signed out" redirects to the login screen and discards the requested URL —
 * so a refresh, a bookmark or a shared link to any in-app destination lands
 * somewhere else. Ch. 21.11 asks that exploration never carry a penalty, and
 * losing your place on refresh is one.
 *
 * Deliberately not a spinner with a message. This resolves within a tick, and
 * "Checking your session…" flashed for one frame is noise; a quiet placeholder
 * that holds the page's background is the honest rendering of "one moment".
 */
export function RouteRestoring() {
  return (
    <div
      className="min-h-screen bg-[#0A0A0F]"
      role="status"
      aria-busy="true"
      aria-label="Restoring your session"
    />
  );
}
