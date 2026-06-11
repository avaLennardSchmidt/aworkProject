import { useEffect } from "react";
import type { AworkUser } from "../types/awork";
import { formatSearchPlaceholder, SearchableSelect } from "./SearchableSelect";

interface PlannerUserSelectorProps {
  currentUser: AworkUser;
  selectedUserId: string;
  users: AworkUser[];
  isLoadingUsers: boolean;
  onLoadUsers: () => Promise<void>;
  onChange: (userId: string) => void;
  analysisHref?: string;
}

export function PlannerUserSelector({
  currentUser,
  selectedUserId,
  users,
  isLoadingUsers,
  onLoadUsers,
  onChange,
  analysisHref,
}: PlannerUserSelectorProps) {
  useEffect(() => {
    if (users.length === 0 && !isLoadingUsers) {
      void onLoadUsers();
    }
  }, [isLoadingUsers, onLoadUsers, users.length]);

  const options = [
    { value: "", label: `Eigener Account (${formatUserName(currentUser)})` },
    ...users
      .filter((user) => user.id !== currentUser.id)
      .map((user) => ({ value: user.id, label: formatUserName(user) })),
  ];

  return (
    <section className="panel planner-user-panel">
      <div>
        <p className="eyebrow">Planner-Nutzer</p>
        <h2>Wessen Plan bearbeitest du?</h2>
      </div>
      <div className="planner-user-controls">
        <div className="form-row">
          <label htmlFor="planner-user-select">Ausgewählter Nutzer</label>
          <SearchableSelect
            buttonId="planner-user-select"
            value={selectedUserId}
            disabled={isLoadingUsers}
            options={options}
            placeholder="Eigener Account"
            searchPlaceholder={formatSearchPlaceholder("Nutzer filtern", options.length)}
            emptyLabel="Keine Nutzer gefunden"
            onChange={onChange}
          />
        </div>
        <button
          type="button"
          className="secondary-button planner-user-refresh"
          disabled={isLoadingUsers}
          onClick={() => void onLoadUsers()}
        >
          {isLoadingUsers ? (
            <>
              <span className="button-spinner" aria-hidden="true" />
              Wird geladen...
            </>
          ) : (
            "Nutzer neu laden"
          )}
        </button>
        {analysisHref ? (
          <a className="primary-link-button planner-analysis-link" href={analysisHref}>
            Kapazität
          </a>
        ) : null}
      </div>
    </section>
  );
}

function formatUserName(user: AworkUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const label = name || user.email || user.id;
  return user.email && name ? `${label} (${user.email})` : label;
}
