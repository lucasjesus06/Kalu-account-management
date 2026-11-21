import { getCurrentMember, listHouseholdMembers } from "@/server/auth";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

export async function MemberAvatars() {
  const member = await getCurrentMember();
  if (!member) {
    return null;
  }

  const members = await listHouseholdMembers(member.householdId);

  return (
    <ul className="flex -space-x-2" aria-label="Integrantes da residência">
      {members.map(({ id, displayName }) => (
        <li
          key={id}
          title={displayName}
          className={cn(
            "flex size-8 items-center justify-center rounded-full text-xs font-bold ring-2 ring-background",
            id === member.memberId ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
          )}
        >
          {initials(displayName)}
        </li>
      ))}
    </ul>
  );
}
