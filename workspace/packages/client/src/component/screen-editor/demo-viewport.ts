// Keep the recorded desktop width, while giving this demo's login form room.
// This is a playback override; captured screen files remain unchanged.
export function getDemoViewportHeight(tourRid: string, recordedHeight: number): number {
  return tourRid === 'customer-portal-ffvb6n1yroikgoti'
    ? Math.max(recordedHeight, 850)
    : recordedHeight;
}
