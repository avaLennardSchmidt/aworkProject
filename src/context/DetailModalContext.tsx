import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence } from "motion/react";
import { ProjectDetailModal } from "../components/ProjectDetailModal";
import { TaskDetailModal } from "../components/TaskDetailModal";

interface DetailModalApi {
  openProjectDetail: (projectId: string) => void;
  openTaskDetail: (taskId: string) => void;
}

const DetailModalContext = createContext<DetailModalApi | null>(null);

/**
 * Provides `openProjectDetail` / `openTaskDetail` to the whole app and renders
 * the two detail modals once. Only one modal is shown at a time — opening a
 * project from within a task modal (via its "Projekt" row) replaces it.
 */
export function DetailModalProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const openProjectDetail = useCallback((id: string) => {
    if (!id) {
      return;
    }
    setTaskId(null);
    setProjectId(id);
  }, []);

  const openTaskDetail = useCallback((id: string) => {
    if (!id) {
      return;
    }
    setProjectId(null);
    setTaskId(id);
  }, []);

  const api = useMemo<DetailModalApi>(
    () => ({ openProjectDetail, openTaskDetail }),
    [openProjectDetail, openTaskDetail],
  );

  return (
    <DetailModalContext.Provider value={api}>
      {children}
      <AnimatePresence>
        {projectId ? (
          <ProjectDetailModal
            key={`project-${projectId}`}
            projectId={projectId}
            onOpenProjectDetail={openProjectDetail}
            onClose={() => setProjectId(null)}
          />
        ) : null}
        {taskId ? (
          <TaskDetailModal
            key={`task-${taskId}`}
            taskId={taskId}
            onOpenProjectDetail={openProjectDetail}
            onClose={() => setTaskId(null)}
          />
        ) : null}
      </AnimatePresence>
    </DetailModalContext.Provider>
  );
}

/** Access the detail-modal openers. Returns no-ops outside a provider. */
export function useDetailModal(): DetailModalApi {
  const context = useContext(DetailModalContext);
  if (!context) {
    return { openProjectDetail: () => {}, openTaskDetail: () => {} };
  }
  return context;
}
