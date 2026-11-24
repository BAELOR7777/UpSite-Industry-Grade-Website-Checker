import type { Organisation, ProjectRecord } from '../types/upsite.ts';

export function sortProjectsByName(projects: ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
      a.id.localeCompare(b.id),
  );
}

export function normalizeOrganisationsProjectOrder(
  organisations: Organisation[],
): Organisation[] {
  return organisations.map((org) => ({
    ...org,
    projects: sortProjectsByName(org.projects || []),
  }));
}
