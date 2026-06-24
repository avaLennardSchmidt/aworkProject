import { useEffect, useState, useCallback, useRef } from "react";
import type { AworkUser } from "../types/awork";
import type { PlannerWorkflow } from "./WorkflowChooser";
import { getProfileImageUrl } from "../services/backendClient";

interface SidebarProps {
  readonly activeItem: PlannerWorkflow;
  readonly capacityHref: string;
  readonly pulseProject?: boolean;
  readonly isCapacityActive?: boolean;
  readonly showWhatsNewDot?: boolean;
  readonly onNavigate: (item: PlannerWorkflow) => void;
  readonly onOpenWhatsNew: () => void;
  // auth
  readonly currentUser?: AworkUser;
  readonly isConnecting?: boolean;
  readonly onLogin: () => void;
  readonly onDisconnect: () => void;
  // planner user
  readonly plannerUserId: string;
  readonly plannerUsers: AworkUser[];
  readonly isLoadingUsers?: boolean;
  readonly onLoadUsers: () => void;
  readonly onPlannerUserChange: (userId: string) => void;
}

const SIDEBAR_STORAGE_KEY = "awork_sidebar_collapsed";

function userName(user: AworkUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email || user.id;
}

function userInitials(user: AworkUser): string {
  const first = user.firstName?.[0] ?? "";
  const last = user.lastName?.[0] ?? "";
  return (first + last).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}

export function Sidebar({
  activeItem,
  isCapacityActive,
  capacityHref,
  pulseProject,
  showWhatsNewDot,
  onNavigate,
  onOpenWhatsNew,
  currentUser,
  isConnecting,
  onLogin,
  onDisconnect,
  plannerUserId,
  plannerUsers,
  isLoadingUsers,
  onLoadUsers,
  onPlannerUserChange,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, []);

  const [showProfilePopup, setShowProfilePopup] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Load users once connected
  useEffect(() => {
    if (currentUser && plannerUsers.length === 0 && !isLoadingUsers) {
      onLoadUsers();
    }
  }, [currentUser, plannerUsers.length, isLoadingUsers, onLoadUsers]);

  // Close profile popup on outside click or Escape
  useEffect(() => {
    if (!showProfilePopup) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowProfilePopup(false);
    }
    function handleClick(e: MouseEvent) {
      if (
        profileRef.current &&
        e.target instanceof Node &&
        !profileRef.current.contains(e.target)
      ) {
        setShowProfilePopup(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showProfilePopup]);

  const profileDisplayName = currentUser ? userName(currentUser) : "";

  const userOptions: { value: string; label: string }[] = [
    {
      value: "",
      label: currentUser
        ? `Eigener Account (${userName(currentUser)})`
        : "Eigener Account",
    },
    ...plannerUsers
      .filter((u) => u.id !== currentUser?.id)
      .map((u) => ({ value: u.id, label: userName(u) })),
  ];

  return (
    <aside
      className={`app-sidebar${collapsed ? " app-sidebar--collapsed" : ""}`}
      aria-label="Seitennavigation"
    >
      {/* Header */}
      <div className="sidebar-header">
        {!collapsed && (
          <span className="sidebar-logo-label">awork planner</span>
        )}
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggle}
          aria-label={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
          title={collapsed ? "Ausklappen" : "Einklappen"}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav" aria-label="Hauptnavigation">
        {/* Kapazität */}
        <a
          href={capacityHref}
          className={`sidebar-nav-item${isCapacityActive ? " sidebar-nav-item--active" : ""}`}
          title={collapsed ? "Kapazität" : undefined}
        >
          <span className="sidebar-nav-icon" aria-hidden="true">
            <CapacityIcon />
          </span>
          {!collapsed && <span className="sidebar-nav-label">Kapazität</span>}
        </a>

        <hr className="sidebar-divider" />

        {/* Planner user selector */}
        {currentUser && !collapsed ? (
          <div className="sidebar-planner-user">
            <span className="sidebar-planner-label">Plan für:</span>
            <select
              className="sidebar-planner-select"
              value={plannerUserId}
              disabled={isLoadingUsers}
              aria-label="Planner-Nutzer auswählen"
              onChange={(e) => onPlannerUserChange(e.target.value)}
            >
              {userOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <hr className="sidebar-divider" />

        {/* Workflow items */}
        <button
          type="button"
          className={`sidebar-nav-item${!isCapacityActive && activeItem === "manage" ? " sidebar-nav-item--active" : ""}`}
          title={collapsed ? "Blocker bearbeiten" : undefined}
          onClick={() => onNavigate("manage")}
        >
          <span className="sidebar-nav-icon" aria-hidden="true">
            <ManageIcon />
          </span>
          {!collapsed && (
            <span className="sidebar-nav-label">Blocker bearbeiten</span>
          )}
        </button>

        <button
          type="button"
          className={`sidebar-nav-item${!isCapacityActive && activeItem === "create" ? " sidebar-nav-item--active" : ""}`}
          title={collapsed ? "Blocker anlegen" : undefined}
          onClick={() => onNavigate("create")}
        >
          <span className="sidebar-nav-icon" aria-hidden="true">
            <CreateIcon />
          </span>
          {!collapsed && (
            <span className="sidebar-nav-label">Blocker anlegen</span>
          )}
        </button>

        <button
          type="button"
          className={`sidebar-nav-item${!isCapacityActive && activeItem === "project" ? " sidebar-nav-item--active" : ""}${pulseProject ? " sidebar-nav-item--pulse" : ""}`}
          title={collapsed ? "Projekt einplanen" : undefined}
          onClick={() => onNavigate("project")}
        >
          <span className="sidebar-nav-icon" aria-hidden="true">
            <ProjectIcon />
          </span>
          {!collapsed && (
            <span className="sidebar-nav-label">
              Projekt einplanen
              {pulseProject && (
                <span className="sidebar-nav-dot" aria-hidden="true" />
              )}
            </span>
          )}
        </button>
      </nav>

      <div className="sidebar-utility">
        <button
          type="button"
          className="sidebar-nav-item sidebar-nav-item--utility"
          title={collapsed ? "What's new" : undefined}
          aria-label="What's New öffnen"
          onClick={onOpenWhatsNew}
        >
          <span
            className="sidebar-nav-icon sidebar-nav-icon--notification"
            aria-hidden="true"
          >
            <AnnouncementIcon />
            {showWhatsNewDot ? (
              <span className="sidebar-nav-dot" aria-hidden="true" />
            ) : null}
          </span>
          {!collapsed && (
            <span className="sidebar-nav-label">What&apos;s new</span>
          )}
        </button>
      </div>

      {/* Profile section at bottom */}
      <div className="sidebar-profile" ref={profileRef}>
        {currentUser ? (
          <>
            {showProfilePopup && (
              <ProfilePopup
                user={currentUser}
                onDisconnect={onDisconnect}
                onClose={() => setShowProfilePopup(false)}
              />
            )}
            <div
              className={`sidebar-profile-user${collapsed ? " sidebar-profile-user--collapsed" : ""}`}
            >
              <button
                type="button"
                className="sidebar-profile-avatar-btn"
                onClick={() => setShowProfilePopup((p) => !p)}
                aria-label="Profil anzeigen"
                aria-expanded={showProfilePopup}
              >
                <UserAvatar user={currentUser} size={32} />
              </button>
              {!collapsed && (
                <span
                  className="sidebar-profile-name"
                  title={profileDisplayName}
                >
                  {profileDisplayName}
                </span>
              )}
              {!collapsed && (
                <button
                  type="button"
                  className="sidebar-profile-disconnect"
                  onClick={onDisconnect}
                  title="Trennen"
                  aria-label="Von awork trennen"
                >
                  <DisconnectIcon />
                </button>
              )}
            </div>
          </>
        ) : (
          <button
            type="button"
            className={`sidebar-login-btn${collapsed ? " sidebar-login-btn--collapsed" : ""}`}
            disabled={isConnecting}
            onClick={onLogin}
            title={collapsed ? "Mit awork anmelden" : undefined}
          >
            <span className="sidebar-nav-icon" aria-hidden="true">
              <LoginIcon />
            </span>
            {!collapsed && (
              <span>
                {isConnecting ? "Verbinden..." : "Mit awork anmelden"}
              </span>
            )}
          </button>
        )}
      </div>
    </aside>
  );
}

function rawField(user: AworkUser, ...keys: string[]): string | undefined {
  const raw = user.raw;
  if (typeof raw !== "object" || raw === null) return undefined;
  const rec = raw as Record<string, unknown>;
  for (const key of keys) {
    const val = rec[key];
    if (typeof val === "string" && val) return val;
  }
  return undefined;
}

function ProfilePopup({
  user,
  onDisconnect,
  onClose,
}: {
  readonly user: AworkUser;
  readonly onDisconnect: () => void;
  readonly onClose: () => void;
}) {
  const position = rawField(user, "position", "jobTitle");
  const userType = rawField(user, "type", "userType");
  const key = rawField(user, "key");

  return (
    <dialog className="sidebar-profile-popup" aria-label="Profil" open>
      <div className="sidebar-profile-popup-header">
        <UserAvatar user={user} size={44} />
        <div className="sidebar-profile-popup-identity">
          <span className="sidebar-profile-popup-name">{userName(user)}</span>
          {user.email && (
            <span className="sidebar-profile-popup-email">{user.email}</span>
          )}
        </div>
      </div>
      <hr className="sidebar-profile-popup-divider" />
      <dl className="sidebar-profile-popup-fields">
        <div className="sidebar-profile-popup-field">
          <dt>Benutzer-ID</dt>
          <dd className="sidebar-profile-popup-id">{user.id}</dd>
        </div>
        {key && (
          <div className="sidebar-profile-popup-field">
            <dt>Kürzel</dt>
            <dd>{key}</dd>
          </div>
        )}
        {position && (
          <div className="sidebar-profile-popup-field">
            <dt>Position</dt>
            <dd>{position}</dd>
          </div>
        )}
        {userType && (
          <div className="sidebar-profile-popup-field">
            <dt>Typ</dt>
            <dd>{userType}</dd>
          </div>
        )}
      </dl>
      <hr className="sidebar-profile-popup-divider" />
      <button
        type="button"
        className="sidebar-profile-popup-disconnect"
        onClick={() => {
          onDisconnect();
          onClose();
        }}
      >
        <DisconnectIcon />
        Von awork trennen
      </button>
    </dialog>
  );
}

function UserAvatar({
  user,
  size,
}: {
  readonly user: AworkUser;
  readonly size: number;
}) {
  const [imgError, setImgError] = useState(false);
  return (
    <span
      className="sidebar-profile-avatar"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {imgError ? (
        userInitials(user)
      ) : (
        <img
          src={getProfileImageUrl(user.id)}
          alt=""
          width={size}
          height={size}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            objectFit: "cover",
          }}
          onError={() => setImgError(true)}
        />
      )}
    </span>
  );
}

function CollapseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 3L5 8l5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 3l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CapacityIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2"
        y="11"
        width="3"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="7"
        y="7"
        width="3"
        height="11"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="12"
        y="4"
        width="3"
        height="14"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M17 2v14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ManageIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 5h14M3 10h14M3 15h8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M14 13l2 2 3-3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CreateIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 4v12M4 10h12"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProjectIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4"
        width="14"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M3 8h14M7 2.5v3M13 2.5v3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M6.5 12l1.5 1.5L11 10.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoginIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M13 14l3-4-3-4M7 10h9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AnnouncementIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 9.25V6.75c0-.6.3-1.16.8-1.49L9.4 1.6a.7.7 0 0 1 1.1.58v11.64a.7.7 0 0 1-1.1.58L3.8 10.74A1.8 1.8 0 0 1 3 9.25Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10.5 7.4 13a1.2 1.2 0 0 1-2.25.8L4.2 11.2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 6c.9.38 1.5 1.16 1.5 2s-.6 1.62-1.5 2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DisconnectIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 3H12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M6 11L3 8l3-3M3 8h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
