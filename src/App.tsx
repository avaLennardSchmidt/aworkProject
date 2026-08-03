import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CAPACITY_PATH,
  WORKFLOW_PATHS,
  isCapacityPath,
  pathToWorkflow,
} from "./services/routes";
import {
  endOfDay,
  endOfYear,
  format,
  isBefore,
  parseISO,
  startOfToday,
} from "date-fns";
import { BackendClient } from "./services/backendClient";
import {
  getStoredSessionId,
  clearStoredSessionId,
} from "./services/backendClient";
import { groupSchedules } from "./services/scheduleGrouping";
import { deleteScheduleGroup } from "./services/scheduleDeleter";
import {
  isOwnSchedule,
  mapTaskSchedulesResponse,
} from "./services/scheduleMapper";
import { enrichSchedulesWithProjectTasks } from "./services/scheduleEnrichment";
import {
  mapProjectTaskResponse,
  mapProjectTasksResponse,
} from "./services/projectTaskMapper";
import { mapProjectsResponse } from "./services/projectMapper";
import { updateScheduleChanges } from "./services/scheduleUpdater";
import { applyBlockerOperations } from "./services/scheduleOperations";
import { mapAbsencesResponse } from "./services/absenceMapper";
import type {
  AworkAbsence,
  AworkProject,
  AworkProjectTask,
  AworkTaskSchedule,
  AworkUserCapacity,
  AworkUser,
  CreateTaskSchedulePayload,
} from "./types/awork";
import type {
  BlockerOperation,
  BlockerOperationResult,
  DeleteResult,
  PlannerFilters,
  PreviewChange,
  ScheduleGroup,
  UpdateResult,
} from "./types/planner";
import { BulkEditModal } from "./components/BulkEditModal";
import {
  CreateScheduleGroupPanel,
  type CreateGroupOptions,
} from "./components/CreateScheduleGroupPanel";
import { ProjectPlanPanel } from "./components/ProjectPlanPanel";
import { DeleteGroupModal } from "./components/DeleteGroupModal";
import { StatusToast } from "./components/StatusToast";
import { FilterPanel } from "./components/FilterPanel";
import { LoadingState } from "./components/LoadingState";
import { ManualBlockerEditModal } from "./components/ManualBlockerEditModal";
import { MultiGroupDurationEditModal } from "./components/MultiGroupDurationEditModal";
import { PreviewChangesModal } from "./components/PreviewChangesModal";
import { BlockerOperationsPreviewModal } from "./components/BlockerOperationsPreviewModal";
import { ScheduleGroupsList } from "./components/ScheduleGroupsList";
import { SuccessPopup } from "./components/SuccessPopup";
import type { PlannerWorkflow } from "./components/WorkflowChooser";
import { Sidebar } from "./components/Sidebar";
import { BackendStartupBanner } from "./components/BackendStartupBanner";
import { CapacityAnalysisPage } from "./components/CapacityAnalysisPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MonitoringModal } from "./components/MonitoringModal";
import { ModalShell } from "./components/ModalShell";
import { DetailModalsAnnouncement } from "./components/DetailModalsAnnouncement";
import { useConfetti } from "./components/Confetti";
import { clearFeatureAccessCache } from "./config/featureAccess";
import { AnimatePresence, motion } from "motion/react";

const backendClient = new BackendClient();
const APP_ANNOUNCEMENT_VERSION = "2026.06";
const FEATURE_KEYS = {
  whatsNew: "whats-new-2026-06-tabellenansicht",
  capacityTableView: "feature-capacity-tabellenansicht-v1",
  projectPlanIntro: "feature-project-einplanen-v1",
  autoPlanIntro: "feature-auto-plan-v1",
  detailViews: "feature-detail-modals-v1",
  // Marker that a user has completed onboarding. Absent only for a brand-new
  // user's first-ever login (all pre-existing users were backfilled with it),
  // which is how we suppress the whole "What's New" backlog for new users.
  onboardingComplete: "onboarding-complete-v1",
} as const;

// Every announcement key a first-time user should start already "seen" on, so
// they only ever get FUTURE announcements — never the existing backlog.
const ALL_ANNOUNCEMENT_KEYS = Object.values(FEATURE_KEYS);

type FeatureModalType = "whats-new" | "project-plan" | "auto-plan";

// Staggered entrance for the feature-announcement copy. Children fade up in
// sequence on top of the modal's own entrance for a livelier reveal.
const featureCopyContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
} as const;

const featureCopyItem = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 420, damping: 34, mass: 0.75 },
  },
} as const;

interface LoadSchedulesOptions {
  refreshNotice?: string;
}

function App() {
  const lastSessionCheckRef = useRef(0);
  const sessionRestoredRef = useRef(false);
  const sessionActivityTrackedRef = useRef(false);
  const [currentUser, setCurrentUser] = useState<AworkUser>();
  const [selectedPlannerUserId, setSelectedPlannerUserId] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  // Route is the single source of truth for which view is active.
  const workflow = pathToWorkflow(location.pathname);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [scheduleRefreshNotice, setScheduleRefreshNotice] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isApplyingBlockerOperations, setIsApplyingBlockerOperations] =
    useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingProjectTasks, setIsLoadingProjectTasks] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isCreatingSchedules, setIsCreatingSchedules] = useState(false);
  const [error, setError] = useState("");
  const [hasMonitoringAccess, setHasMonitoringAccess] = useState(false);
  const [showMonitoringModal, setShowMonitoringModal] = useState(false);
  const [activeFeatureModal, setActiveFeatureModal] =
    useState<FeatureModalType | null>(null);
  const [seenFeatureKeys, setSeenFeatureKeys] = useState<Set<string>>(
    new Set(),
  );
  const [featureKeysLoaded, setFeatureKeysLoaded] = useState(false);
  const [confettiTick, setConfettiTick] = useState(0);
  const [detailAnnouncementOpen, setDetailAnnouncementOpen] = useState(false);
  const [detailAnnouncementHandled, setDetailAnnouncementHandled] =
    useState(false);
  // True for a brand-new user's first session — suppresses every announcement.
  const [isNewUserSession, setIsNewUserSession] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [createSuccess, setCreateSuccess] = useState<{
    count: number;
    failed: number;
    taskCreated?: string;
  }>();
  const [updateSuccess, setUpdateSuccess] = useState<{
    count: number;
    failed: number;
    title?: string;
    detail?: string;
  }>();
  const [deleteSuccess, setDeleteSuccess] = useState<{
    count: number;
    failed: number;
  }>();
  const [allSchedules, setAllSchedules] = useState<AworkTaskSchedule[]>([]);
  const [plannerAbsences, setPlannerAbsences] = useState<AworkAbsence[]>([]);
  const [availableProjects, setAvailableProjects] = useState<AworkProject[]>(
    [],
  );
  const [availableUsers, setAvailableUsers] = useState<AworkUser[]>([]);
  const [projectTasksForCreate, setProjectTasksForCreate] = useState<
    AworkProjectTask[]
  >([]);
  const [hasLoadedSchedules, setHasLoadedSchedules] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ScheduleGroup>();
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [multiEditGroups, setMultiEditGroups] = useState<ScheduleGroup[]>();
  const [manualEditGroup, setManualEditGroup] = useState<ScheduleGroup>();
  const [deleteGroup, setDeleteGroup] = useState<ScheduleGroup>();
  const [previewChanges, setPreviewChanges] = useState<PreviewChange[]>();
  const [blockerOperations, setBlockerOperations] =
    useState<BlockerOperation[]>();
  const [blockerOperationResults, setBlockerOperationResults] =
    useState<BlockerOperationResult[]>();
  const [updateResults, setUpdateResults] = useState<UpdateResult[]>();
  const [deleteResults, setDeleteResults] = useState<DeleteResult[]>();
  const [filters, setFilters] = useState<PlannerFilters>(() => ({
    from: format(new Date(), "yyyy-MM-dd"),
    to: format(endOfYear(new Date()), "yyyy-MM-dd"),
    hidePast: true,
    projectId: "",
    onlyAssigned: false,
  }));
  const [myAssignedTaskIds, setMyAssignedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [myAssignedProjectIds, setMyAssignedProjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [isMultiEditAvailable] = useState(true);
  const isAnalysisRoute = isCapacityPath(location.pathname);

  // Legacy links (pre-router): "?view=analysis" or a "/analysis" path open the
  // capacity page. Redirect once on mount; strip ONLY the "view" param so the
  // OAuth/session params from the login redirect stay intact.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const legacyAnalysis =
      params.get("view") === "analysis" ||
      window.location.pathname.replace(/\/$/, "").endsWith("/analysis");
    if (legacyAnalysis) {
      params.delete("view");
      const search = params.toString();
      const base = import.meta.env.BASE_URL || "/";
      window.history.replaceState(
        {},
        "",
        `${base}${search ? `?${search}` : ""}${window.location.hash}`,
      );
      navigate(CAPACITY_PATH, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function consumeLoginRedirectFlag(): boolean {
    const wasRedirect =
      sessionStorage.getItem("awork_planner_login_redirect") === "1";
    if (wasRedirect) {
      sessionStorage.removeItem("awork_planner_login_redirect");
    }
    return wasRedirect;
  }

  useEffect(() => {
    // Wake the backend on load and show the startup banner while it spins up.
    // Runs regardless of auth state so a cold start is visible before login.
    void backendClient.warmUp();
  }, []);

  useEffect(() => {
    // Session ID is captured from URL by inline script in index.html (before React loads).
    // Here we just check if we have a stored session and restore it.
    if (getStoredSessionId()) {
      void restoreBackendSession(consumeLoginRedirectFlag());
    }
  }, []);

  useEffect(() => {
    function shouldCheckSession() {
      return Boolean(currentUser || getStoredSessionId());
    }

    function maybeRestoreSession() {
      if (!shouldCheckSession() || isConnecting) {
        return;
      }

      const now = Date.now();
      if (now - lastSessionCheckRef.current < 5000) {
        return;
      }

      lastSessionCheckRef.current = now;
      void restoreBackendSession();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        maybeRestoreSession();
      }
    }

    window.addEventListener("focus", maybeRestoreSession);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", maybeRestoreSession);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentUser, isConnecting]);

  useEffect(() => {
    if (!currentUser) {
      setSeenFeatureKeys(new Set());
      setFeatureKeysLoaded(false);
      return;
    }

    let cancelled = false;
    setFeatureKeysLoaded(false);

    // The database is the single source of truth: removing a row there brings
    // the feature notification (and confetti) back. No local cache, so we
    // never have a stale "seen" flag to override a deleted server entry.
    void backendClient
      .getSeenFeatureKeys()
      .then((remoteKeys) => {
        if (cancelled) return;
        const seen = new Set(remoteKeys);
        // First-ever login: the onboarding marker is absent (all pre-existing
        // users were backfilled with it). Silently mark every current
        // announcement as seen and persist it, so a brand-new user never gets
        // the backlog of "What's New" popups — only future updates.
        if (!seen.has(FEATURE_KEYS.onboardingComplete)) {
          setIsNewUserSession(true);
          for (const key of ALL_ANNOUNCEMENT_KEYS) {
            seen.add(key);
          }
          setSeenFeatureKeys(seen);
          void acknowledgeFeatures(ALL_ANNOUNCEMENT_KEYS);
        } else {
          setSeenFeatureKeys(seen);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatusMessage(
          "Feature-Hinweise konnten nicht geladen werden. Bitte lade die Seite neu.",
        );
      })
      .finally(() => {
        if (!cancelled) setFeatureKeysLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Auto-show the "detail modals" announcement once per user on load, after the
  // seen-keys have been fetched. The DB is the single source of truth, so it
  // reappears only if the row is removed there.
  useEffect(() => {
    if (!featureKeysLoaded || !currentUser || detailAnnouncementHandled) {
      return;
    }
    setDetailAnnouncementHandled(true);
    if (
      !isNewUserSession &&
      !activeFeatureModal &&
      !seenFeatureKeys.has(FEATURE_KEYS.detailViews)
    ) {
      setDetailAnnouncementOpen(true);
      fireConfetti();
    }
  }, [
    featureKeysLoaded,
    currentUser,
    detailAnnouncementHandled,
    isNewUserSession,
    activeFeatureModal,
    seenFeatureKeys,
  ]);

  async function acknowledgeFeature(featureKey: string) {
    if (!currentUser) return;
    setSeenFeatureKeys((current) => {
      const next = new Set(current);
      next.add(featureKey);
      return next;
    });

    try {
      await backendClient.markFeatureSeen(featureKey, APP_ANNOUNCEMENT_VERSION);
    } catch (err) {
      console.error(
        `[feature-announcement] Failed to save feature ${featureKey}:`,
        err,
      );
      setStatusMessage(
        "Feature-Hinweis konnte nicht gespeichert werden. Bitte versuche es erneut.",
      );
    }
  }

  async function acknowledgeFeatures(featureKeys: readonly string[]) {
    const uniqueFeatureKeys = Array.from(new Set(featureKeys));
    for (const featureKey of uniqueFeatureKeys) {
      await acknowledgeFeature(featureKey);
    }
  }

  function fireConfetti() {
    setConfettiTick((tick) => tick + 1);
  }

  function openWhatsNew() {
    setActiveFeatureModal("whats-new");
    // Confetti only on the first open, while the "new" dot is still showing.
    if (featureKeysLoaded && !seenFeatureKeys.has(FEATURE_KEYS.whatsNew)) {
      fireConfetti();
    }
  }

  function handleWorkflowChange(nextWorkflow: PlannerWorkflow) {
    navigate(WORKFLOW_PATHS[nextWorkflow]);
    if (
      nextWorkflow === "project" &&
      featureKeysLoaded &&
      !seenFeatureKeys.has(FEATURE_KEYS.projectPlanIntro)
    ) {
      fireConfetti();
      setActiveFeatureModal("project-plan");
    }
  }

  function handleAutoPlanOpen() {
    if (featureKeysLoaded && !seenFeatureKeys.has(FEATURE_KEYS.autoPlanIntro)) {
      fireConfetti();
      setActiveFeatureModal("auto-plan");
    }
  }

  async function confirmFeatureModal(featureKeys: readonly string[]) {
    await acknowledgeFeatures(featureKeys);
    setActiveFeatureModal(null);
  }

  const pulseProjectWorkflow =
    featureKeysLoaded && !seenFeatureKeys.has(FEATURE_KEYS.projectPlanIntro);
  const pulseAutoPlanMode =
    featureKeysLoaded && !seenFeatureKeys.has(FEATURE_KEYS.autoPlanIntro);
  const showWhatsNewDot =
    featureKeysLoaded && !seenFeatureKeys.has(FEATURE_KEYS.whatsNew);
  const showCapacityTableBadge =
    featureKeysLoaded && !seenFeatureKeys.has(FEATURE_KEYS.capacityTableView);
  const shouldShowLegacyWhatsNew =
    featureKeysLoaded &&
    (!seenFeatureKeys.has(FEATURE_KEYS.projectPlanIntro) ||
      !seenFeatureKeys.has(FEATURE_KEYS.autoPlanIntro));

  useConfetti(confettiTick, {
    particleCount: 130,
    startVelocity: 32,
    spread: 80,
  });

  const featureAnnouncementModal = activeFeatureModal ? (
    <ModalShell
      labelledBy="feature-announcement-title"
      dialogClassName="modal feature-announcement-modal"
      onClose={() => setActiveFeatureModal(null)}
    >
      <div className="modal-header feature-announcement-header">
        <h2 id="feature-announcement-title">
          {activeFeatureModal === "whats-new"
            ? "What's New"
            : activeFeatureModal === "project-plan"
              ? "Neu: Projekt einplanen"
              : "Neu: Auto Plan"}
        </h2>
        <button
          type="button"
          className="ghost-button feature-announcement-close"
          onClick={() => setActiveFeatureModal(null)}
          aria-label="Popup schließen"
        >
          ×
        </button>
      </div>

      {activeFeatureModal === "whats-new" ? (
        <motion.div
          className="feature-announcement-copy"
          variants={featureCopyContainer}
          initial="hidden"
          animate="visible"
        >
          {shouldShowLegacyWhatsNew ? (
            <>
              <motion.h3
                className="release-notes-headline"
                variants={featureCopyItem}
              >
                Tabellenansicht, Projekt einplanen und Auto Plan
              </motion.h3>
              <motion.p
                className="release-notes-intro"
                variants={featureCopyItem}
              >
                Diese Funktionen sind neu oder wurden zuletzt ergänzt.
              </motion.p>
              <div className="feature-announcement-list">
                <motion.div className="feature-item" variants={featureCopyItem}>
                  <h4>Tabellenansicht in Kapazität</h4>
                  <p className="feature-path">
                    <strong>So findest du es:</strong> Sidebar → Kapazität →
                    Tabellenansicht
                  </p>
                  <ul className="feature-item-list">
                    <li>zusätzliche Ansicht neben der Balkenansicht</li>
                    <li>kompakter Wochenvergleich pro Nutzer</li>
                    <li>
                      Stunden, Kunden-Ziel, Projekte und Abwesenheiten auf einen
                      Blick
                    </li>
                  </ul>
                </motion.div>
                <motion.div className="feature-item" variants={featureCopyItem}>
                  <h4>Projekt einplanen</h4>
                  <p className="feature-path">
                    <strong>So findest du es:</strong> Sidebar → Projekt
                    einplanen
                  </p>
                  <ul className="feature-item-list">
                    <li>mehrere Projektaufgaben in einem Schritt planen</li>
                    <li>Wochentage und Arbeitszeiten einmal festlegen</li>
                    <li>
                      Verteilung vor dem Speichern in der Vorschau anpassen
                    </li>
                  </ul>
                </motion.div>
                <motion.div className="feature-item" variants={featureCopyItem}>
                  <h4>Auto Plan</h4>
                  <p className="feature-path">
                    <strong>So findest du es:</strong> Sidebar → Blocker anlegen
                    → Auto Plan
                  </p>
                  <ul className="feature-item-list">
                    <li>freie Zeitfenster automatisch finden</li>
                    <li>Dauer, Zeitraum und Arbeitszeiten vorgeben</li>
                    <li>passende Blocker vor dem Speichern prüfen</li>
                  </ul>
                </motion.div>
              </div>
            </>
          ) : (
            <>
              <motion.h3
                className="release-notes-headline"
                variants={featureCopyItem}
              >
                Neu in Kapazität: Tabellenansicht
              </motion.h3>
              <motion.p
                className="release-notes-intro"
                variants={featureCopyItem}
              >
                Die Kapazitätsanalyse hat jetzt zusätzlich eine kompakte
                Tabellenansicht.
              </motion.p>
              <div className="feature-announcement-list">
                <motion.div className="feature-item" variants={featureCopyItem}>
                  <h4>Was du bekommst</h4>
                  <p className="feature-path">
                    <strong>So findest du es:</strong> Sidebar → Kapazität →
                    Tabellenansicht
                  </p>
                  <ul className="feature-item-list">
                    <li>Wochen direkt nebeneinander vergleichen</li>
                    <li>geplante Stunden und Auslastung sofort lesen</li>
                    <li>Projektblöcke und Abwesenheiten kompakt sehen</li>
                  </ul>
                </motion.div>
                <motion.div className="feature-item" variants={featureCopyItem}>
                  <h4>Warum das hilfreich ist</h4>
                  <ul className="feature-item-list">
                    <li>Überbuchungen fallen schneller auf</li>
                    <li>Zielwerte bleiben farblich gut lesbar</li>
                    <li>geeignet für schnelle Team- und Wochenchecks</li>
                  </ul>
                </motion.div>
              </div>
            </>
          )}
        </motion.div>
      ) : activeFeatureModal === "project-plan" ? (
        <motion.div
          className="feature-announcement-copy"
          variants={featureCopyContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.h3
            className="release-notes-headline"
            variants={featureCopyItem}
          >
            Projekt einplanen
          </motion.h3>
          <motion.p className="release-notes-intro" variants={featureCopyItem}>
            Mehrere Aufgaben eines Projekts in einem Schritt einplanen.
          </motion.p>
          <motion.p
            className="feature-path feature-path--standalone"
            variants={featureCopyItem}
          >
            <strong>So findest du es:</strong> Sidebar → Projekt einplanen
          </motion.p>
          <ul className="feature-steps">
            <motion.li variants={featureCopyItem}>
              Projekt öffnen und relevante Aufgaben auswählen
            </motion.li>
            <motion.li variants={featureCopyItem}>
              Wochentage, Startzeit, Endzeit und Verteilung festlegen
            </motion.li>
            <motion.li variants={featureCopyItem}>
              Vorschlag vor dem Speichern in der Vorschau prüfen
            </motion.li>
            <motion.li variants={featureCopyItem}>
              Blocker bei Bedarf verschieben oder entfernen
            </motion.li>
            <motion.li variants={featureCopyItem}>
              Planung gesammelt übernehmen
            </motion.li>
          </ul>
          <motion.p className="feature-callout" variants={featureCopyItem}>
            <strong>Hinweis:</strong> Die Planung berücksichtigt nur awork
            Blocker. Outlook-Termine und andere Kalendereinträge werden nicht
            einbezogen.
          </motion.p>
        </motion.div>
      ) : (
        <motion.div
          className="feature-announcement-copy"
          variants={featureCopyContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.h3
            className="release-notes-headline"
            variants={featureCopyItem}
          >
            Auto Plan
          </motion.h3>
          <motion.p className="release-notes-intro" variants={featureCopyItem}>
            Aufgaben schneller in passende freie Zeitfenster legen.
          </motion.p>
          <motion.p
            className="feature-path feature-path--standalone"
            variants={featureCopyItem}
          >
            <strong>So findest du es:</strong> Sidebar → Blocker anlegen → Auto
            Plan
          </motion.p>
          <ul className="feature-steps">
            <motion.li variants={featureCopyItem}>
              Dauer, Zeitraum, Wochentage und Arbeitszeiten vorgeben
            </motion.li>
            <motion.li variants={featureCopyItem}>
              freie Slots automatisch suchen lassen
            </motion.li>
            <motion.li variants={featureCopyItem}>
              Vorschläge auf Kapazität und Verfügbarkeit prüfen
            </motion.li>
            <motion.li variants={featureCopyItem}>
              Blocker vor dem Speichern anpassen oder direkt übernehmen
            </motion.li>
          </ul>
          <motion.p className="feature-callout" variants={featureCopyItem}>
            <strong>Hinweis:</strong> Auto Plan bezieht nur awork Aufgaben im
            Kalender ein. Meetings und andere Kalendereinträge werden nicht
            berücksichtigt.
          </motion.p>
        </motion.div>
      )}

      <div className="modal-actions">
        {activeFeatureModal !== "whats-new" ? (
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void confirmFeatureModal(
                activeFeatureModal === "project-plan"
                  ? [FEATURE_KEYS.projectPlanIntro]
                  : [FEATURE_KEYS.autoPlanIntro],
              )
            }
          >
            OK, nicht mehr anzeigen
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            onClick={() => void confirmFeatureModal([FEATURE_KEYS.whatsNew])}
          >
            OK, verstanden
          </button>
        )}
      </div>
    </ModalShell>
  ) : null;

  const plannerUser = useMemo(() => {
    if (!currentUser) return undefined;
    if (!selectedPlannerUserId) return currentUser;
    return (
      availableUsers.find((user) => user.id === selectedPlannerUserId) ?? {
        id: selectedPlannerUserId,
      }
    );
  }, [availableUsers, currentUser, selectedPlannerUserId]);

  const plannerAbsenceRanges = useMemo(() => {
    if (!plannerUser) return [];
    return plannerAbsences
      .filter((a) => a.userId === plannerUser.id)
      .map((a) => ({ startOn: a.startOn, endOn: a.endOn }));
  }, [plannerAbsences, plannerUser]);

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    const candidateSchedules = plannerUser
      ? getPlannerSchedules(allSchedules, plannerUser)
      : [];

    candidateSchedules.forEach((schedule) => {
      if (schedule.projectId && schedule.projectName) {
        projects.set(schedule.projectId, schedule.projectName);
      }
    });

    return Array.from(projects.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allSchedules, plannerUser]);

  const filteredSchedules = useMemo(() => {
    if (!plannerUser) return [];

    const today = startOfToday();
    const fromDate = parseISO(filters.from);
    const toDate = endOfDay(parseISO(filters.to));

    return getPlannerSchedules(allSchedules, plannerUser).filter((schedule) => {
      const scheduleStart = parseISO(schedule.start);
      const scheduleEnd = parseISO(schedule.end);

      if (scheduleStart > toDate || scheduleEnd < fromDate) {
        return false;
      }
      if (filters.hidePast && isBefore(scheduleEnd, today)) return false;
      if (filters.projectId && schedule.projectId !== filters.projectId)
        return false;
      if (
        filters.onlyAssigned &&
        myAssignedTaskIds.size > 0 &&
        !myAssignedTaskIds.has(schedule.taskId)
      )
        return false;
      return true;
    });
  }, [
    allSchedules,
    plannerUser,
    filters.from,
    filters.to,
    filters.hidePast,
    filters.projectId,
    filters.onlyAssigned,
    myAssignedTaskIds,
  ]);

  const groups = useMemo(
    () => groupSchedules(filteredSchedules),
    [filteredSchedules],
  );
  const selectedGroups = useMemo(
    () => groups.filter((group) => selectedGroupIds.has(group.groupId)),
    [groups, selectedGroupIds],
  );

  async function restoreBackendSession(returnedFromLogin = false) {
    setIsConnecting(true);
    setError("");
    if (returnedFromLogin) {
      setStatusMessage("awork Login abgeschlossen. Session wird geprüft...");
    }

    // Retry up to 3 times to handle Render cold starts
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const status = await backendClient.getAuthStatus();
        if (status.authenticated && status.user) {
          setCurrentUser(status.user);
          setSelectedPlannerUserId("");
          backendClient
            .getMonitoringAccess()
            .then((r) => setHasMonitoringAccess(r.hasAccess))
            .catch(() => setHasMonitoringAccess(false));
          if (!sessionActivityTrackedRef.current) {
            sessionActivityTrackedRef.current = true;
            backendClient.trackActivity("session_start").catch(() => {});
          }
          if (returnedFromLogin) {
            setStatusMessage("awork Login erfolgreich. Workflow wählen.");
            sessionRestoredRef.current = true;
            sessionStorage.setItem("awork_planner_session_restored", "1");
          } else if (
            !sessionRestoredRef.current &&
            !sessionStorage.getItem("awork_planner_session_restored")
          ) {
            setStatusMessage("awork-Session wiederhergestellt.");
            sessionRestoredRef.current = true;
            sessionStorage.setItem("awork_planner_session_restored", "1");
          }
          setIsConnecting(false);
          return;
        } else if (returnedFromLogin) {
          // Session not found in backend — might be Render cold start, DB not yet loaded
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          clearStoredSessionId();
          setError(
            "awork Login erfolgreich, aber keine Backend-Session gefunden. Bitte erneut anmelden.",
          );
        } else {
          // Stored session is stale
          clearStoredSessionId();
        }
        break;
      } catch (sessionError) {
        lastError = sessionError;
        if (attempt < 2) {
          // The centered BackendStartupBanner overlay already signals the
          // "backend starting" state — no extra top-right toast needed here.
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
      }
    }

    setCurrentUser(undefined);
    if (lastError && !error) {
      setError(
        lastError instanceof Error
          ? lastError.message
          : "Backend-Session konnte nicht geprüft werden.",
      );
    }
    setIsConnecting(false);
  }

  function handleLogin() {
    window.location.href = backendClient.getLoginUrl();
  }

  function handlePlannerUserChange(userId: string) {
    setSelectedPlannerUserId(userId);
    setAllSchedules([]);
    setPlannerAbsences([]);
    setProjectTasksForCreate([]);
    setHasLoadedSchedules(false);
    setFilters((currentFilters) => ({ ...currentFilters, projectId: "" }));
    setMyAssignedTaskIds(new Set());
    setMyAssignedProjectIds(new Set());
    setSelectedGroup(undefined);
    setSelectedGroupIds(new Set());
    setMultiEditGroups(undefined);
    setManualEditGroup(undefined);
    setDeleteGroup(undefined);
    setPreviewChanges(undefined);
    setBlockerOperations(undefined);
    setBlockerOperationResults(undefined);
    setUpdateResults(undefined);
    setDeleteResults(undefined);
    setCreateSuccess(undefined);
    setUpdateSuccess(undefined);
    setDeleteSuccess(undefined);
    setStatusMessage("");
    setError("");
  }

  async function handleDisconnect() {
    await backendClient.logout();
    clearFeatureAccessCache();
    sessionRestoredRef.current = false;
    setCurrentUser(undefined);
    setHasMonitoringAccess(false);
    setShowMonitoringModal(false);
    setSelectedPlannerUserId("");
    setAllSchedules([]);
    setPlannerAbsences([]);
    setAvailableProjects([]);
    setAvailableUsers([]);
    setProjectTasksForCreate([]);
    setHasLoadedSchedules(false);
    setSelectedGroup(undefined);
    setSelectedGroupIds(new Set());
    setMultiEditGroups(undefined);
    setManualEditGroup(undefined);
    setDeleteGroup(undefined);
    setPreviewChanges(undefined);
    setBlockerOperations(undefined);
    setBlockerOperationResults(undefined);
    setUpdateResults(undefined);
    setDeleteResults(undefined);
    setCreateSuccess(undefined);
    setUpdateSuccess(undefined);
    setDeleteSuccess(undefined);
    setStatusMessage("Getrennt.");
    setError("");
    setMyAssignedTaskIds(new Set());
    setMyAssignedProjectIds(new Set());
  }

  async function loadSchedules(options: LoadSchedulesOptions = {}) {
    if (!plannerUser) {
      setError("Bitte zuerst mit awork verbinden.");
      return;
    }

    setIsLoadingSchedules(true);
    setScheduleRefreshNotice(options.refreshNotice ?? "");
    setError("");
    setStatusMessage("");

    try {
      const [
        scheduleResponse,
        plannerUserTaskResponse,
        myAssignedTasksResponse,
      ] = await Promise.all([
        backendClient.getTaskSchedules({
          from: filters.from,
          to: filters.to,
          userId: plannerUser.id,
        }),
        !selectedPlannerUserId
          ? backendClient.getMyProjectTasks()
          : backendClient.getUserAssignedTasks(plannerUser.id),
        currentUser
          ? backendClient.getUserAssignedTasks(currentUser.id)
          : Promise.resolve<unknown>(null),
      ]);
      const mapped = mapTaskSchedulesResponse(scheduleResponse);
      const projectTasks = await loadMissingProjectTasks(
        mapProjectTasksResponse(plannerUserTaskResponse),
        mapped.schedules,
      );
      const myTasksArray = mapProjectTasksResponse(myAssignedTasksResponse);
      const myTaskIds = new Set(myTasksArray.map((t) => t.id));
      const myProjectIds = new Set(
        myTasksArray
          .map((t) => t.projectId)
          .filter((id): id is string => Boolean(id)),
      );
      setMyAssignedTaskIds(myTaskIds);
      setMyAssignedProjectIds(myProjectIds);
      const scheduledTaskIds = new Set(
        mapped.schedules.map((schedule) => schedule.taskId),
      );
      const unscheduledAssignedTasks = projectTasks
        .filter((task) => !scheduledTaskIds.has(task.id))
        .filter((task) => isTaskActive(task))
        .sort((a, b) => {
          const projectOrder = (a.projectName ?? "").localeCompare(
            b.projectName ?? "",
          );
          if (projectOrder !== 0) {
            return projectOrder;
          }

          return (a.name ?? "").localeCompare(b.name ?? "");
        });
      const enrichedSchedules = enrichSchedulesWithProjectTasks(
        mapped.schedules.map((schedule) => ({
          ...schedule,
          userId: plannerUser.id,
        })),
        projectTasks,
      );
      setAllSchedules(enrichedSchedules);
      setSelectedGroupIds(new Set());
      setHasLoadedSchedules(true);
      try {
        const absencesRaw = await backendClient.getAbsences();
        setPlannerAbsences(mapAbsencesResponse(absencesRaw));
      } catch {
        // Absence data unavailable — date picker shows no absence highlights
      }

      if (mapped.schedules.length === 0) {
        setStatusMessage(
          mapped.warnings.length > 0
            ? "awork hat Blocker zurückgegeben, aber die Felder konnten nicht gelesen werden."
            : unscheduledAssignedTasks.length > 0
              ? `${unscheduledAssignedTasks.length} aktive Aufgaben gefunden, aber keine haben Blocker in diesem Zeitraum.`
              : "Keine geplanten Blocker in diesem Zeitraum.",
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Aufgaben-Blocker konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingSchedules(false);
      setScheduleRefreshNotice("");
    }
  }

  async function loadMissingProjectTasks(
    projectTasks: AworkProjectTask[],
    schedules: AworkTaskSchedule[],
  ): Promise<AworkProjectTask[]> {
    const tasksById = new Map(projectTasks.map((task) => [task.id, task]));
    const missingTaskIds = Array.from(
      new Set(
        schedules
          .map((schedule) => schedule.taskId)
          .filter((taskId) => !tasksById.has(taskId)),
      ),
    );

    if (missingTaskIds.length === 0) {
      return projectTasks;
    }

    const resolvedTasks = await Promise.all(
      missingTaskIds.map(async (taskId) => {
        try {
          return mapProjectTaskResponse(await backendClient.getTask(taskId));
        } catch {
          return null;
        }
      }),
    );

    return [
      ...projectTasks,
      ...resolvedTasks.filter((task): task is AworkProjectTask =>
        Boolean(task),
      ),
    ];
  }

  async function loadProjects() {
    if (!currentUser) return;

    setIsLoadingProjects(true);
    setError("");

    try {
      const [projectsResponse, myTasksResponse] = await Promise.all([
        backendClient.getProjects(),
        myAssignedTaskIds.size === 0
          ? backendClient.getUserAssignedTasks(currentUser.id)
          : Promise.resolve<unknown>(null),
      ]);
      setAvailableProjects(mapProjectsResponse(projectsResponse));
      if (myAssignedTaskIds.size === 0) {
        const myTasksArray = mapProjectTasksResponse(myTasksResponse);
        setMyAssignedTaskIds(new Set(myTasksArray.map((t) => t.id)));
        setMyAssignedProjectIds(
          new Set(
            myTasksArray
              .map((t) => t.projectId)
              .filter((id): id is string => Boolean(id)),
          ),
        );
      }
    } catch (projectError) {
      setError(
        projectError instanceof Error
          ? projectError.message
          : "Projekte konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingProjects(false);
    }
  }

  async function loadUsers() {
    if (!currentUser) return;

    setIsLoadingUsers(true);
    setError("");

    try {
      const users = await backendClient.getUsers();
      setAvailableUsers(users);
    } catch (usersError) {
      setError(
        usersError instanceof Error
          ? usersError.message
          : "awork-Nutzer konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingUsers(false);
    }
  }

  async function loadProjectTasks(projectId: string) {
    setIsLoadingProjectTasks(true);
    setError("");

    try {
      const response = await backendClient.getProjectTasks(projectId);
      setProjectTasksForCreate(mapProjectTasksResponse(response));
    } catch (taskError) {
      setError(
        taskError instanceof Error
          ? taskError.message
          : "Projektaufgaben konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingProjectTasks(false);
    }
  }

  async function loadProjectTasksList(
    projectId: string,
  ): Promise<AworkProjectTask[]> {
    const response = await backendClient.getProjectTasks(projectId);
    return mapProjectTasksResponse(response);
  }

  async function createProjectSchedules(
    payloads: CreateTaskSchedulePayload[],
  ): Promise<boolean> {
    if (!plannerUser) {
      setError("Bitte Planner-Nutzer auswählen.");
      return false;
    }
    if (payloads.length === 0) return false;

    setIsCreatingSchedules(true);
    setError("");
    let successCount = 0;
    const failures: string[] = [];

    try {
      try {
        const response = await backendClient.batchTaskSchedules({
          userId: plannerUser.id,
          source: "project-plan",
          create: payloads.map((payload) => ({
            ...payload,
            userId: plannerUser.id,
          })),
        });
        successCount = response.succeeded.length;
        failures.push(...response.failed.map((entry) => entry.error));
      } catch (createError) {
        failures.push(
          createError instanceof Error
            ? createError.message
            : "Anlegen fehlgeschlagen.",
        );
      }

      setStatusMessage(
        `${successCount} Blocker angelegt. ${failures.length} fehlgeschlagen.`,
      );
      if (successCount > 0) {
        setCreateSuccess({ count: successCount, failed: failures.length });
      }
      if (failures.length > 0) setError(failures.slice(0, 3).join(" | "));
      if (successCount > 0 && hasLoadedSchedules) {
        await loadSchedules({
          refreshNotice:
            "Projekt-Blocker nach dem Anlegen werden aktualisiert. Du kannst weiterarbeiten, neue awork-Daten erscheinen gleich.",
        });
      }

      return successCount > 0;
    } finally {
      setIsCreatingSchedules(false);
    }
  }

  async function loadCreateSchedules(
    from: string,
    to: string,
  ): Promise<AworkTaskSchedule[]> {
    if (!plannerUser) {
      return [];
    }

    const response = await backendClient.getTaskSchedules({
      from,
      to,
      userId: plannerUser.id,
    });
    const mapped = mapTaskSchedulesResponse(response);
    const projectTasks = await loadMissingProjectTasks(
      projectTasksForCreate,
      mapped.schedules,
    );

    return enrichSchedulesWithProjectTasks(
      mapped.schedules.map((schedule) => ({
        ...schedule,
        userId: plannerUser.id,
      })),
      projectTasks,
    );
  }

  async function loadPlannerUserCapacity(): Promise<
    AworkUserCapacity | undefined
  > {
    if (!plannerUser) {
      return undefined;
    }

    return backendClient.getUserCapacity(plannerUser.id);
  }

  async function createTaskSchedules(
    payloads: CreateTaskSchedulePayload[],
    options: CreateGroupOptions,
  ): Promise<boolean> {
    if (!plannerUser) {
      setError("Bitte Planner-Nutzer auswählen.");
      return false;
    }

    setIsCreatingSchedules(true);
    setError("");

    let successCount = 0;
    const failures: string[] = [];
    let taskId = payloads[0]?.taskId;
    let taskCreated: string | undefined;

    try {
      if (options.newTaskName) {
        const plannedDuration = payloads.reduce(
          (sum, payload) => sum + payload.plannedDuration,
          0,
        );
        const createdTaskResponse = await backendClient.createProjectTask(
          options.projectId,
          {
            name: options.newTaskName,
            plannedDuration,
            userId: plannerUser?.id,
          },
        );
        const createdTask = mapProjectTaskResponse(createdTaskResponse);

        if (!createdTask) {
          throw new Error(
            "Neue Aufgabe angelegt, aber die Antwort konnte nicht verarbeitet werden.",
          );
        }

        taskId = createdTask.id;
        taskCreated = createdTask.name ?? options.newTaskName;
        setProjectTasksForCreate((currentTasks) => [
          createdTask,
          ...currentTasks.filter((task) => task.id !== createdTask.id),
        ]);
      }

      const creatable: CreateTaskSchedulePayload[] = [];
      for (const payload of payloads) {
        if (payload.userId !== plannerUser?.id) {
          failures.push(
            `${payload.startDate}: Berechtigung vor dem Anlegen konnte nicht geprüft werden.`,
          );
          continue;
        }

        if (!taskId) {
          failures.push(`${payload.startDate}: Aufgaben-ID fehlt.`);
          continue;
        }

        creatable.push({ ...payload, taskId });
      }

      if (creatable.length > 0) {
        try {
          const response = await backendClient.batchTaskSchedules({
            userId: plannerUser?.id,
            create: creatable.map((payload) => ({ ...payload })),
          });
          successCount = response.succeeded.length;
          failures.push(...response.failed.map((entry) => entry.error));
        } catch (createError) {
          failures.push(
            createError instanceof Error
              ? createError.message
              : "Anlegen fehlgeschlagen.",
          );
        }
      }

      setStatusMessage(
        taskCreated
          ? `Aufgabe "${taskCreated}" angelegt. ${successCount} Blocker angelegt. ${failures.length} fehlgeschlagen.`
          : `${successCount} Blocker angelegt. ${failures.length} fehlgeschlagen.`,
      );
      if (successCount > 0 || taskCreated) {
        setCreateSuccess({
          count: successCount,
          failed: failures.length,
          taskCreated,
        });
      }
      if (failures.length > 0) setError(failures.slice(0, 3).join(" | "));
      if (successCount > 0 && hasLoadedSchedules) {
        await loadSchedules({
          refreshNotice:
            "Aufgaben-Blocker nach dem Anlegen werden aktualisiert. Du kannst weiterarbeiten, neue awork-Daten erscheinen gleich.",
        });
      }

      return successCount > 0;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Aufgabe oder Blocker konnten nicht angelegt werden.",
      );
      return false;
    } finally {
      setIsCreatingSchedules(false);
    }
  }

  function handlePreview(changes: PreviewChange[]) {
    setPreviewChanges(changes);
    setUpdateResults(undefined);
  }

  function handleBlockerOperationsPreview(operations: BlockerOperation[]) {
    setBlockerOperations(operations);
    setBlockerOperationResults(undefined);
  }

  function handleManualEditRequest(group: ScheduleGroup) {
    setSelectedGroup(undefined);
    setManualEditGroup(group);
  }

  async function handleDeleteGroup() {
    if (!plannerUser || !deleteGroup) return;

    setIsDeleting(true);
    setError("");

    try {
      const results = await deleteScheduleGroup(
        backendClient,
        plannerUser,
        deleteGroup,
      );
      setDeleteResults(results);
      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;
      setStatusMessage(
        `${successCount} Blocker ausgeplant. ${failureCount} fehlgeschlagen.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setDeleteSuccess({ count: successCount, failed: failureCount });
      }
      if (successCount > 0) {
        await loadSchedules({
          refreshNotice:
            "Geplante Aufgaben werden nach dem Ausplanen aktualisiert. Du kannst weiterarbeiten – neue awork-Daten erscheinen gleich.",
        });
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Blocker konnten nicht ausgeplant werden.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleApplyBlockerOperations() {
    if (!plannerUser || !blockerOperations) return;

    setIsApplyingBlockerOperations(true);
    setError("");

    try {
      const results = await applyBlockerOperations(
        backendClient,
        plannerUser,
        blockerOperations,
      );
      setBlockerOperationResults(results);
      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;
      setStatusMessage(
        `${successCount} Blocker-Operationen angewendet. ${failureCount} fehlgeschlagen.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setUpdateSuccess({
          count: successCount,
          failed: failureCount,
          title: "BÄM, Blocker angepasst.",
          detail:
            "Ausgewählte Blocker wurden aktualisiert, hinzugefügt oder ausgeplant. Die awork-Aufgabe wurde nicht gelöscht.",
        });
      }
      if (successCount > 0) {
        await loadSchedules({
          refreshNotice:
            "Geplante Aufgaben werden nach den Blocker-Änderungen aktualisiert. Du kannst weiterarbeiten – neue awork-Daten erscheinen gleich.",
        });
      }
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : "Blocker-Operationen konnten nicht angewendet werden.",
      );
    } finally {
      setIsApplyingBlockerOperations(false);
    }
  }

  async function handleApplyChanges() {
    if (!plannerUser || !previewChanges) return;

    setIsUpdating(true);
    setError("");

    try {
      const results = await updateScheduleChanges(
        backendClient,
        plannerUser,
        previewChanges,
      );
      setUpdateResults(results);
      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;
      setStatusMessage(
        `${successCount} Blocker aktualisiert. ${failureCount} fehlgeschlagen.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setUpdateSuccess({ count: successCount, failed: failureCount });
      }
      await loadSchedules({
        refreshNotice:
          "Geplante Aufgaben werden nach der Bearbeitung aktualisiert. Du kannst weiterarbeiten – neue awork-Daten erscheinen gleich.",
      });
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Aktualisierungen konnten nicht angewendet werden.",
      );
    } finally {
      setIsUpdating(false);
    }
  }

  function closeModals() {
    setSelectedGroup(undefined);
    setMultiEditGroups(undefined);
    setManualEditGroup(undefined);
    setDeleteGroup(undefined);
    setPreviewChanges(undefined);
    setBlockerOperations(undefined);
    setBlockerOperationResults(undefined);
    setUpdateResults(undefined);
    setDeleteResults(undefined);
  }

  if (isAnalysisRoute) {
    return (
      <div className="app-layout">
        <BackendStartupBanner backendClient={backendClient} />
        <Sidebar
          activeItem={workflow}
          isCapacityActive={isAnalysisRoute}
          capacityHref={`#${CAPACITY_PATH}`}
          pulseProject={pulseProjectWorkflow}
          showWhatsNewDot={showWhatsNewDot}
          onNavigate={handleWorkflowChange}
          onOpenWhatsNew={openWhatsNew}
          currentUser={currentUser}
          isConnecting={isConnecting}
          onLogin={handleLogin}
          onDisconnect={handleDisconnect}
          plannerUserId={selectedPlannerUserId}
          plannerUsers={availableUsers}
          isLoadingUsers={isLoadingUsers}
          onLoadUsers={() => {
            void loadUsers();
          }}
          onPlannerUserChange={handlePlannerUserChange}
        />
        <div className="app-layout-content">
          <ErrorBoundary fallbackTitle="Kapazitätsansicht konnte nicht geladen werden.">
            <CapacityAnalysisPage
              backendClient={backendClient}
              currentUser={currentUser}
              isConnecting={isConnecting}
              isAuthorized
              isCheckingAccess={false}
              showTableViewBadge={showCapacityTableBadge}
              onTableViewSeen={() =>
                acknowledgeFeature(FEATURE_KEYS.capacityTableView)
              }
              onLogin={handleLogin}
              onDisconnect={handleDisconnect}
            />
          </ErrorBoundary>
          {featureAnnouncementModal}
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <BackendStartupBanner backendClient={backendClient} />
      <Sidebar
        activeItem={workflow}
        capacityHref={`#${CAPACITY_PATH}`}
        pulseProject={pulseProjectWorkflow}
        showWhatsNewDot={showWhatsNewDot}
        onNavigate={handleWorkflowChange}
        onOpenWhatsNew={openWhatsNew}
        currentUser={currentUser}
        isConnecting={isConnecting}
        onLogin={handleLogin}
        onDisconnect={handleDisconnect}
        plannerUserId={selectedPlannerUserId}
        plannerUsers={availableUsers}
        isLoadingUsers={isLoadingUsers}
        onLoadUsers={() => {
          void loadUsers();
        }}
        onPlannerUserChange={handlePlannerUserChange}
      />
      <div className="app-layout-content">
        <main className="app-shell">
          <header className="app-header">
            <div>
              <p className="eyebrow">awork planner utility</p>
              <h1>
                Self-Service Bulk Planner
                {hasMonitoringAccess ? (
                  <button
                    className="monitoring-trigger"
                    onClick={() => setShowMonitoringModal(true)}
                    aria-label="Monitoring Tool öffnen"
                    title="Monitoring Tool"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 16h16M4 12l3-4 3 2 4-6 2 3"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : null}
              </h1>
            </div>
            <p>
              Geplante Aufgaben-Blocker für den ausgewählten Planner-Nutzer
              bearbeiten.
            </p>
          </header>

          {workflow === "manage" ? (
            <>
              <FilterPanel
                filters={filters}
                projectOptions={projectOptions}
                hasLoadedSchedules={hasLoadedSchedules}
                disabled={!plannerUser}
                isLoading={isLoadingSchedules}
                onChange={setFilters}
                onLoad={loadSchedules}
              />

              {isLoadingSchedules ? (
                <p className="loading-text-hint">
                  Geplante Aufgaben werden geladen...
                </p>
              ) : null}
              {scheduleRefreshNotice ? (
                <div className="refresh-notice" aria-live="polite">
                  <span className="refresh-notice__icon" aria-hidden="true">
                    <span className="spinner" />
                  </span>
                  <div className="refresh-notice-copy">
                    <span className="refresh-notice-title">
                      Synchronisiere geplante Aufgaben im Hintergrund...
                    </span>
                    <span className="refresh-notice-detail">
                      {scheduleRefreshNotice}
                    </span>
                  </div>
                </div>
              ) : null}
              <ScheduleGroupsList
                groups={groups}
                hasLoaded={hasLoadedSchedules}
                selectedGroupIds={selectedGroupIds}
                onSelectionChange={setSelectedGroupIds}
                onMultiEdit={() => setMultiEditGroups(selectedGroups)}
                onChangeTimeWindow={setSelectedGroup}
                onDeleteGroup={(group) => {
                  setDeleteGroup(group);
                  setDeleteResults(undefined);
                }}
                isMultiEditAvailable={isMultiEditAvailable}
              />
            </>
          ) : workflow === "create" && plannerUser ? (
            <CreateScheduleGroupPanel
              currentUser={plannerUser}
              projects={availableProjects}
              tasks={projectTasksForCreate}
              isLoadingProjects={isLoadingProjects}
              isLoadingTasks={isLoadingProjectTasks}
              isCreating={isCreatingSchedules}
              myAssignedTaskIds={myAssignedTaskIds}
              myAssignedProjectIds={myAssignedProjectIds}
              absenceRanges={plannerAbsenceRanges}
              onLoadProjects={loadProjects}
              onProjectChange={loadProjectTasks}
              onLoadExistingSchedules={loadCreateSchedules}
              onLoadUserCapacity={loadPlannerUserCapacity}
              pulseAutoPlan={pulseAutoPlanMode}
              onOpenAutoPlan={handleAutoPlanOpen}
              onCreate={createTaskSchedules}
            />
          ) : workflow === "project" && plannerUser ? (
            <ProjectPlanPanel
              currentUser={plannerUser}
              projects={availableProjects}
              isLoadingProjects={isLoadingProjects}
              isCreating={isCreatingSchedules}
              myAssignedProjectIds={myAssignedProjectIds}
              onLoadProjects={loadProjects}
              onLoadProjectTasks={loadProjectTasksList}
              onLoadExistingSchedules={loadCreateSchedules}
              onLoadUserCapacity={loadPlannerUserCapacity}
              onCreate={createProjectSchedules}
            />
          ) : workflow === "create" || workflow === "project" ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Workflow</p>
                  <h2>
                    {workflow === "project"
                      ? "Projekt einplanen"
                      : "Blocker anlegen"}
                  </h2>
                </div>
              </div>
            </section>
          ) : null}

          <DetailModalsAnnouncement
            open={detailAnnouncementOpen}
            onClose={() => setDetailAnnouncementOpen(false)}
            onDismiss={() => {
              void acknowledgeFeature(FEATURE_KEYS.detailViews);
              setDetailAnnouncementOpen(false);
            }}
          />

          {activeFeatureModal ? (
            <ModalShell
              labelledBy="feature-announcement-title"
              dialogClassName="modal feature-announcement-modal"
              onClose={() => setActiveFeatureModal(null)}
            >
              <div className="modal-header feature-announcement-header">
                <h2 id="feature-announcement-title">
                  {activeFeatureModal === "whats-new"
                    ? "What's New"
                    : activeFeatureModal === "project-plan"
                      ? "Neu: Projekt einplanen"
                      : "Neu: Auto Plan"}
                </h2>
                <button
                  type="button"
                  className="ghost-button feature-announcement-close"
                  onClick={() => setActiveFeatureModal(null)}
                  aria-label="Popup schließen"
                >
                  ×
                </button>
              </div>

              {activeFeatureModal === "whats-new" ? (
                <motion.div
                  className="feature-announcement-copy"
                  variants={featureCopyContainer}
                  initial="hidden"
                  animate="visible"
                >
                  {shouldShowLegacyWhatsNew ? (
                    <>
                      <motion.h3
                        className="release-notes-headline"
                        variants={featureCopyItem}
                      >
                        🎉 Tabellenansicht, Projekt einplanen und Auto Plan sind
                        da
                      </motion.h3>
                      <motion.p
                        className="release-notes-intro"
                        variants={featureCopyItem}
                      >
                        Du bekommst hier gesammelt alle Funktionen, die in den
                        letzten Releases neu dazugekommen sind, damit du nichts
                        verpasst und danach ohne weitere Intro-Popups
                        weiterarbeiten kannst.
                      </motion.p>
                      <div className="feature-announcement-list">
                        <motion.div
                          className="feature-item"
                          variants={featureCopyItem}
                        >
                          <h4>📊 Neue Tabellenansicht in Kapazität</h4>
                          <p>
                            In der Kapazitätsanalyse kannst du jetzt zwischen
                            Balkenansicht und Tabellenansicht wechseln. Die
                            Tabellenansicht zeigt dir geplante Stunden,
                            Kunden-Ziel, Projektblöcke und Abwesenheiten kompakt
                            pro Woche, damit du Überlastung und freie Kapazität
                            schneller vergleichen kannst.
                          </p>
                        </motion.div>
                        <motion.div
                          className="feature-item"
                          variants={featureCopyItem}
                        >
                          <h4>✨ Projekt einplanen</h4>
                          <p>
                            Schluss mit dem Planen Aufgabe für Aufgabe. Öffne
                            ein Projekt, wähle die Aufgaben aus, die das Tool
                            einplanen soll, lege Wochentage und Arbeitszeiten
                            fest, und das Tool verteilt sie automatisch sinnvoll
                            über deinen Kalender. Es berücksichtigt deine
                            aktuelle Auslastung und findet den nächsten freien
                            Slot. Das Tool plant dabei ausschließlich rund um
                            deine awork Blocker. Termine aus Outlook und andere
                            Kalendereinträge werden nicht einbezogen. Vor dem
                            Speichern justierst du in der Vorschau alles nach.
                          </p>
                        </motion.div>
                        <motion.div
                          className="feature-item"
                          variants={featureCopyItem}
                        >
                          <h4>⚡ Auto Plan</h4>
                          <p>
                            Du hast eine Aufgabe, weißt aber nicht, wann sie
                            reinpasst? Das übernimmt Auto Plan. Du gibst
                            Zeitraum, Arbeitszeiten und Dauer vor, und das Tool
                            durchsucht deinen Kalender, findet freie Slots und
                            schlägt dir passende Zeiten vor. Auto Plan bezieht
                            dabei nur deine awork Aufgaben im Kalender ein.
                            Kalendereinträge wie Meetings bleiben
                            unberücksichtigt.
                          </p>
                        </motion.div>
                      </div>
                    </>
                  ) : (
                    <>
                      <motion.h3
                        className="release-notes-headline"
                        variants={featureCopyItem}
                      >
                        📊 Neu in Kapazität: Tabellenansicht
                      </motion.h3>
                      <motion.p
                        className="release-notes-intro"
                        variants={featureCopyItem}
                      >
                        Neben der Balkenansicht gibt es jetzt eine neue
                        Tabellenansicht, mit der du Wochen, Auslastung und
                        Projektverteilung deutlich kompakter lesen kannst.
                      </motion.p>
                      <div className="feature-announcement-list">
                        <motion.div
                          className="feature-item"
                          variants={featureCopyItem}
                        >
                          <h4>🗂️ Wochen kompakt vergleichen</h4>
                          <p>
                            Jede Woche wird pro Nutzer in einer eigenen Zelle
                            dargestellt. So siehst du geplante Stunden,
                            Auslastung, Projektblöcke und Abwesenheiten direkt
                            nebeneinander.
                          </p>
                        </motion.div>
                        <motion.div
                          className="feature-item"
                          variants={featureCopyItem}
                        >
                          <h4>🎯 Engpässe schneller erkennen</h4>
                          <p>
                            Farben und Kennzahlen orientieren sich an der
                            bestehenden Kapazitätslogik. Überbuchte Wochen
                            fallen sofort auf, während Zielwerte und Projektlast
                            übersichtlich lesbar bleiben.
                          </p>
                        </motion.div>
                      </div>
                    </>
                  )}
                </motion.div>
              ) : activeFeatureModal === "project-plan" ? (
                <motion.div
                  className="feature-announcement-copy"
                  variants={featureCopyContainer}
                  initial="hidden"
                  animate="visible"
                >
                  <motion.h3
                    className="release-notes-headline"
                    variants={featureCopyItem}
                  >
                    🚀 Endlich da: Projekt einplanen
                  </motion.h3>
                  <motion.p
                    className="release-notes-intro"
                    variants={featureCopyItem}
                  >
                    Das Problem kennst du: Dein Projekt in awork steht, die
                    Aufgaben sind definiert, aber jetzt musst du jede Aufgabe
                    einzeln einplanen. Das kostet Zeit, vor allem bei einer
                    ganzen Reihe von Aufgaben.
                  </motion.p>
                  <motion.p
                    className="release-notes-solution"
                    variants={featureCopyItem}
                  >
                    <strong>So funktioniert es:</strong> Öffne „Projekt
                    einplanen", wähle dein Projekt, hake die Aufgaben an, die
                    eingeplant werden sollen, und das Tool übernimmt den Rest.
                  </motion.p>
                  <ul className="feature-steps">
                    <motion.li variants={featureCopyItem}>
                      💡 Das Tool liest die awork Zeitrahmen und die geplante
                      Dauer jeder Aufgabe automatisch aus
                    </motion.li>
                    <motion.li variants={featureCopyItem}>
                      📅 Du legst fest: Wochentage, Startzeit und Endzeit pro
                      Tag sowie die Verteilung (gleichmäßig oder gebündelt)
                    </motion.li>
                    <motion.li variants={featureCopyItem}>
                      🎯 Das Tool plant alle Aufgaben sinnvoll rund um deine
                      bestehenden awork Blocker
                    </motion.li>
                    <motion.li variants={featureCopyItem}>
                      ✏️ In der Vorschau verschiebst oder löschst du jeden
                      Blocker noch nach Belieben
                    </motion.li>
                    <motion.li variants={featureCopyItem}>
                      ✅ Ein Klick und alle Blocker sind angelegt
                    </motion.li>
                  </ul>
                  <motion.p
                    className="feature-callout"
                    variants={featureCopyItem}
                  >
                    📌 <strong>Gut zu wissen:</strong> Das Tool plant
                    ausschließlich rund um deine awork Blocker und findet dafür
                    den passenden Slot. Termine aus Outlook und andere
                    Kalendereinträge werden nicht einbezogen.
                  </motion.p>
                </motion.div>
              ) : (
                <motion.div
                  className="feature-announcement-copy"
                  variants={featureCopyContainer}
                  initial="hidden"
                  animate="visible"
                >
                  <motion.h3
                    className="release-notes-headline"
                    variants={featureCopyItem}
                  >
                    ⚡ Auto Plan: dein neuer Zeitmanager
                  </motion.h3>
                  <motion.p
                    className="release-notes-intro"
                    variants={featureCopyItem}
                  >
                    Du kennst die Situation: „Diese Aufgabe muss noch irgendwann
                    rein, aber wann passt sie?" Das ständige Ausprobieren im
                    Kalender kostet Nerven: freie Lücken suchen, schieben,
                    verwerfen. Damit ist jetzt Schluss.
                  </motion.p>
                  <motion.p
                    className="release-notes-solution"
                    variants={featureCopyItem}
                  >
                    <strong>Das übernimmt Auto Plan:</strong> Gib der Aufgabe
                    eine Dauer, einen Zeitraum und deine Arbeitszeiten vor, und
                    das Tool durchsucht deinen Kalender automatisch, findet
                    freie Slots und schlägt dir passende Zeitfenster vor.
                  </motion.p>
                  <ul className="feature-steps">
                    <motion.li variants={featureCopyItem}>
                      ⏱️ Du gibst vor: Dauer (z.B. 8 Stunden), Zeitraum (z.B.
                      diese und nächste Woche), Wochentage (Montag bis Freitag)
                      und Arbeitszeiten (9 bis 17 Uhr)
                    </motion.li>
                    <motion.li variants={featureCopyItem}>
                      🔍 Das Tool scannt deinen aktuellen Kalender automatisch
                    </motion.li>
                    <motion.li variants={featureCopyItem}>
                      📍 Es findet zusammenhängende freie Slots und
                      berücksichtigt deine Kapazität
                    </motion.li>
                    <motion.li variants={featureCopyItem}>
                      ✅ Das Tool schlägt dir sinnvolle Blocker vor (z.B. Mo 2h,
                      Di 2h, Mi 2h, Do 2h)
                    </motion.li>
                    <motion.li variants={featureCopyItem}>
                      🎯 Du prüfst alles in der Vorschau und passt es bei Bedarf
                      an oder speicherst direkt
                    </motion.li>
                  </ul>
                  <motion.p
                    className="feature-callout"
                    variants={featureCopyItem}
                  >
                    📌 <strong>Gut zu wissen:</strong> Auto Plan bezieht nur
                    deine awork Aufgaben im Kalender ein. Kalendereinträge wie
                    Meetings werden nicht berücksichtigt.
                  </motion.p>
                </motion.div>
              )}

              <div className="modal-actions">
                {activeFeatureModal !== "whats-new" ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      void confirmFeatureModal(
                        activeFeatureModal === "project-plan"
                          ? [FEATURE_KEYS.projectPlanIntro]
                          : [FEATURE_KEYS.autoPlanIntro],
                      )
                    }
                  >
                    OK, nicht mehr anzeigen
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      void confirmFeatureModal([FEATURE_KEYS.whatsNew])
                    }
                  >
                    OK, verstanden
                  </button>
                )}
              </div>
            </ModalShell>
          ) : null}

          {selectedGroup && plannerUser && !previewChanges ? (
            <BulkEditModal
              group={selectedGroup}
              currentUser={plannerUser}
              onClose={closeModals}
              onPreview={handlePreview}
              onManualEditRequest={handleManualEditRequest}
            />
          ) : null}

          {multiEditGroups &&
          plannerUser &&
          !previewChanges &&
          !blockerOperations &&
          isMultiEditAvailable ? (
            <MultiGroupDurationEditModal
              groups={multiEditGroups}
              currentUser={plannerUser}
              onClose={closeModals}
              onPreview={handlePreview}
              onUnplanPreview={(operations) => {
                setMultiEditGroups(undefined);
                handleBlockerOperationsPreview(operations);
              }}
            />
          ) : null}

          {manualEditGroup && plannerUser ? (
            <ManualBlockerEditModal
              group={manualEditGroup}
              currentUser={plannerUser}
              onBack={() => {
                setSelectedGroup(manualEditGroup);
                setManualEditGroup(undefined);
              }}
              onClose={closeModals}
              onPreview={handleBlockerOperationsPreview}
            />
          ) : null}

          {deleteGroup ? (
            <DeleteGroupModal
              group={deleteGroup}
              isDeleting={isDeleting}
              deleteResults={deleteResults}
              onCancel={closeModals}
              onDelete={handleDeleteGroup}
            />
          ) : null}

          {createSuccess ? (
            <SuccessPopup
              title="Blocker angelegt"
              message={`${createSuccess.count} Blocker erfolgreich angelegt.`}
              detail={
                createSuccess.taskCreated
                  ? `Aufgabe angelegt: ${createSuccess.taskCreated}. ${createSuccess.failed > 0 ? `${createSuccess.failed} Blocker fehlgeschlagen.` : "Alle Blocker wurden für den Planner-Nutzer angelegt."}`
                  : createSuccess.failed > 0
                    ? `${createSuccess.failed} fehlgeschlagen und unverändert geblieben.`
                    : "Alle Blocker wurden für den ausgewählten Planner-Nutzer angelegt."
              }
              onClose={() => setCreateSuccess(undefined)}
            />
          ) : null}

          {deleteSuccess ? (
            <SuccessPopup
              title="Gruppe ausgeplant"
              message={`${deleteSuccess.count} Blocker erfolgreich ausgeplant.`}
              detail="Alle ausgewählten Blocker wurden aus dem Planner entfernt. Die awork-Aufgabe wurde nicht gelöscht."
              onClose={() => setDeleteSuccess(undefined)}
            />
          ) : null}

          {updateSuccess ? (
            <SuccessPopup
              title={updateSuccess.title ?? "Zeitfenster angepasst"}
              message={`${updateSuccess.count} Blocker erfolgreich aktualisiert.`}
              detail={
                updateSuccess.detail ??
                "Das neue Zeitfenster wurde auf die ausgewählten Blocker angewendet."
              }
              onClose={() => setUpdateSuccess(undefined)}
            />
          ) : null}

          {blockerOperations ? (
            <BlockerOperationsPreviewModal
              operations={blockerOperations}
              isApplying={isApplyingBlockerOperations}
              results={blockerOperationResults}
              onBack={() => {
                setBlockerOperations(undefined);
                setBlockerOperationResults(undefined);
              }}
              onCancel={closeModals}
              onApply={handleApplyBlockerOperations}
            />
          ) : null}

          {previewChanges ? (
            <PreviewChangesModal
              changes={previewChanges}
              isUpdating={isUpdating}
              updateResults={updateResults}
              onBack={() => {
                setPreviewChanges(undefined);
                setUpdateResults(undefined);
              }}
              onCancel={closeModals}
              onApply={handleApplyChanges}
            />
          ) : null}

          {showMonitoringModal ? (
            <MonitoringModal
              backendClient={backendClient}
              onClose={() => setShowMonitoringModal(false)}
            />
          ) : null}

          <div className="status-toast-region">
            <AnimatePresence>
              {error ? (
                <StatusToast
                  key="error"
                  message={error}
                  variant="error"
                  onDismiss={() => setError("")}
                />
              ) : null}
              {statusMessage ? (
                <StatusToast
                  key="status"
                  message={statusMessage}
                  variant="success"
                  autoDismissMs={5000}
                  onDismiss={() => setStatusMessage("")}
                />
              ) : null}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;

function isTaskActive(task: AworkProjectTask): boolean {
  const normalizedStatusType = task.statusType?.trim().toLowerCase();
  return (
    !normalizedStatusType ||
    !["done", "completed", "closed"].includes(normalizedStatusType)
  );
}

function getPlannerSchedules(
  schedules: AworkTaskSchedule[],
  plannerUser: AworkUser,
): AworkTaskSchedule[] {
  return schedules.filter((schedule) => isOwnSchedule(schedule, plannerUser));
}

