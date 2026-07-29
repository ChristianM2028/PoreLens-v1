/** Deployment contract shared by every module loaded during application startup. */
export const APPLICATION_VERSION='2026.07.29-pr49.1';

export const versionedModuleUrl=path=>`${path}?v=${encodeURIComponent(APPLICATION_VERSION)}`;
