import { useState } from "react";
import { getProfileImageUrl } from "../services/backendClient";

/**
 * A round user avatar: shows the awork profile photo, and falls back to the
 * user's initials in a coloured badge when no image is available. Works from
 * either a full awork user (firstName/lastName) or a display name.
 */
export interface AvatarUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  name?: string;
}

export function UserAvatar({
  user,
  size = 28,
  className,
}: {
  user: AvatarUser;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = initialsOf(user);

  return (
    <span
      className={`user-avatar${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      title={displayName(user)}
    >
      {failed ? (
        <span
          className="user-avatar-initials"
          style={{ fontSize: Math.round(size * 0.4) }}
          aria-hidden="true"
        >
          {initials}
        </span>
      ) : (
        <img
          className="user-avatar-img"
          src={getProfileImageUrl(user.id)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function initialsOf(user: AvatarUser): string {
  const first = user.firstName?.[0] ?? "";
  const last = user.lastName?.[0] ?? "";
  const fromParts = (first + last).toUpperCase();
  if (fromParts) {
    return fromParts;
  }
  if (user.name) {
    const words = user.name.trim().split(/\s+/).filter(Boolean);
    const letters = words.slice(0, 2).map((word) => word[0]);
    if (letters.length > 0) {
      return letters.join("").toUpperCase();
    }
  }
  return (user.email?.[0] ?? "?").toUpperCase();
}

function displayName(user: AvatarUser): string {
  const composed = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return composed || user.name || user.email || user.id;
}
