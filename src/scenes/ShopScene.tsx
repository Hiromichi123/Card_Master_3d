import type { RouteId } from '../app/routes';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { MallScene } from './MallScene';

/** Legacy entry links now open the matching mall category. */
export interface ShopSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly busy: boolean;
  readonly kind: 'normal' | 'activity';
  readonly onNavigate: (route: RouteId) => void;
}
export function ShopScene({ kind, ...props }: ShopSceneProps) {
  return <MallScene {...props} initialTab={kind === 'normal' ? 'myth' : 'event'} />;
}
