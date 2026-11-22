export const householdRoles = ["admin", "member"] as const;
export type HouseholdRole = (typeof householdRoles)[number];

export function displayNameFromEmail(email: string | null | undefined) {
  const local = (email ?? "").split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) {
    return "Eu";
  }
  return local
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 60);
}
