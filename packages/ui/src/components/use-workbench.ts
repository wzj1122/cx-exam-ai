import { useCallback, useSyncExternalStore } from 'react';
import type { WorkbenchController, WorkbenchState } from '../state/workbench-controller';

export function useWorkbenchState(controller: WorkbenchController): WorkbenchState {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const snapshot = useCallback(() => controller.getState(), [controller]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
