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
}

export function PlannerUserSelector({
  currentUser,
  selectedUserId,
  users,
  isLoadingUsers,
  onLoadUsers,
  onChange,
}: PlannerUserSelectorProps) {
  useEffect(() => {
    if (users.length === 0 && !isLoadingUsers) {
      void onLoadUsers();
    }
  }, [isLoadingUsers, onLoadUsers, users.length]);

  const options = [
    { value: "", label: `My own account (${formatUserName(currentUser)})` },
    ...users
      .filter((user) => user.id !== currentUser.id)
      .map((user) => ({ value: user.id, label: formatUserName(user) })),
  ];

  return (
    <section className="panel planner-user-panel">
      <div>
        <p className="eyebrow">Planner user</p>
        <h2>Whose schedule are you editing?</h2>
      </div>
      <div className="planner-user-controls">
        <div className="form-row">
          <label>Selected user</label>
          <SearchableSelect
            value={selectedUserId}
            disabled={isLoadingUsers}
            options={options}
            placeholder="My own account"
            searchPlaceholder={formatSearchPlaceholder("Filter users", options.length)}
            emptyLabel="No users found"
            onChange={onChange}
          />
        </div>
        <button
          type="button"
          className="secondary-button planner-user-refresh"
          disabled={isLoadingUsers}
          onClick={() => void onLoadUsers()}
        >
          {isLoadingUsers ? "Loading..." : "Reload users"}
        </button>
      </div>
    </section>
  );
}

function formatUserName(user: AworkUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const label = name || user.email || user.id;
  return user.email && name ? `${label} (${user.email})` : label;
}
