export interface GuardedNavItem { to: string; perm: string }

/** Direct-URL guard: true when the nav entry governing `pathname` (detail routes resolve to their parent) is not permitted. */
export function routeDenied(pathname: string, items: readonly GuardedNavItem[], can: (perm: string) => boolean): boolean {
  const hit = items
    .filter((i) => i.to !== "/" && (pathname === i.to || pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return Boolean(hit && !can(hit.perm));
}
