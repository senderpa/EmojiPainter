import { useEffect } from 'react';

import { startLifetimeActivity } from './lifetimeActivity';
import type { LifetimeWorkspace } from './lifetimeStats';

export const useLifetimeActivity = (workspace: LifetimeWorkspace, active = true) => {
  useEffect(() => {
    if (!active) return undefined;
    return startLifetimeActivity(workspace);
  }, [active, workspace]);
};
