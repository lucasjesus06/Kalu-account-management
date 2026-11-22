import { getCurrentContext, listHouseholdMembers } from "@/server/auth";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

export async function MemberAvatars() {
  const { profile, household } = await getCurrentContext();
  if (!household) {
    return null;
  }

  const members = await listHouseholdMembers(household.householdId);

  return (
    <ul className="flex -space-x-1.5" aria-label="Integrantes da residência">
      {members.map(({ id, displayName }, index) => (
        <li
          key={id}
          title={displayName}
          style={{ zIndex: members.length - index }}
          className={cn(
            "relative flex size-8 items-center justify-center rounded-full text-xs font-bold ring-2 ring-background",
            id === profile.memberId ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
          )}
        >
          {initials(displayName)}
        </li>
      ))}
    </ul>
  );
}
