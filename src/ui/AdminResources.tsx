import { useRef, useState } from 'react';
import type { ProfileStore } from '../state/createProfileStore';
import { pushToast } from '../state/toastStore';
import './adminNav.css';

const GRANT_AMOUNT = 50_000;

/** The original test grant transaction, moved to the expanded admin toolbar. */
export function AdminResources({ store, busy }: { readonly store: ProfileStore | null; readonly busy: boolean }) {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const grant = async (currency: 'gold' | 'crystal') => {
    if (!store || busy || locked.current || store.getSnapshot().busy || store.getSnapshot().status !== 'ready') return;
    locked.current = true; setPending(true);
    try {
      const outcome = await store.commitEconomic<null>(() => ({
        transaction: {
          operationId: store.nextOperationId(), currencyDelta: { [currency]: GRANT_AMOUNT }, inventoryDelta: {},
        },
        view: null,
      }));
      if (outcome.ok) pushToast(`测试资源：已增加 ${GRANT_AMOUNT} ${currency === 'gold' ? '金币' : '水晶'}`, 'info');
      // ProfileStore reports a failed save through the global notice host.
    } catch (error) { pushToast(error instanceof Error ? error.message : '测试资源发放失败', 'error'); }
    finally { locked.current = false; setPending(false); }
  };
  return <div className="admin-resources" aria-label="测试资源">
    <span>测试资源</span>
    <button type="button" className="btn btn--tiny" data-testid="grant-gold" disabled={!store || busy || pending}
      onClick={() => void grant('gold')}>+50000 金币</button>
    <button type="button" className="btn btn--tiny" data-testid="grant-crystal" disabled={!store || busy || pending}
      onClick={() => void grant('crystal')}>+50000 水晶</button>
  </div>;
}
