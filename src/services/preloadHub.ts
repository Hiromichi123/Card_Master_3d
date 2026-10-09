import { assetManifest } from '../data/assets';
import { menuPosters } from '../scenes/menuPosters';

let pending: Promise<void> | null = null;

/** Warm the actual lobby image resources during the intro, before the portal reveals it. */
export function preloadHub(): Promise<void> {
  if (pending) return pending;
  const urls = [assetManifest.shared.menu['menu_bg']?.url, ...menuPosters()]
    .filter((url): url is string => Boolean(url));
  pending = Promise.all(urls.map((url) => new Promise<void>((resolve) => {
    const image = new Image();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve();
    };
    // A missing optional poster must not make a valid account wait indefinitely.
    const timer = window.setTimeout(finish, 6000);
    image.onload = () => { void image.decode().catch(() => {}).then(finish); };
    image.onerror = finish;
    image.src = url;
    if (image.complete && image.naturalWidth > 0) void image.decode().catch(() => {}).then(finish);
  }))).then(() => {});
  return pending;
}
