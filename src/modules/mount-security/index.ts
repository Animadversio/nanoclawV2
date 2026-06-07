/**
 * Mount Security Module for NanoClaw
 *
 * Validates additional mounts against an allowlist stored OUTSIDE the project root.
 * This prevents container agents from modifying security configuration.
 *
 * Allowlist location: ~/.config/nanoclaw/mount-allowlist.json
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MOUNT_ALLOWLIST_PATH } from '../../config.js';
import { log } from '../../log.js';

export interface AdditionalMount {
  hostPath: string;
  containerPath?: string;
  readonly?: boolean;
}

export interface MountAllowlist {
  allowedRoots: AllowedRoot[];
  blockedPatterns: string[];
}

export interface AllowedRoot {
  path: string;
  allowReadWrite: boolean;
  description?: string;
}

// Cache the allowlist in memory - only reloads on process restart
let cachedAllowlist: MountAllowlist | null = null;
let allowlistLoadError: string | null = null;

/**
 * Default blocked patterns - paths that should never be mounted
 */
const DEFAULT_BLOCKED_PATTERNS = [
  '.ssh',
  '.gnupg',
  '.gpg',
  '.aws',
  '.azure',
  '.gcloud',
  '.kube',
  '.docker',
  'credentials',
  '.env',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'private_key',
  '.secret',
];

/**
 * Load the mount allowlist from the external config location.
 * Returns null if the file doesn't exist or is invalid.
 * Result is cached in memory for the lifetime of the process.
 */
export function loadMountAllowlist(): MountAllowlist | null {
  if (cachedAllowlist !== null) {
    return cachedAllowlist;
  }

  if (allowlistLoadError !== null) {
    // Already tried and failed, don't spam logs
    return null;
  }

  try {
    if (!fs.existsSync(MOUNT_ALLOWLIST_PATH)) {
      // Do NOT cache this as an error — file may be created later without restart.
      // Only parse/structural errors are permanently cached.
      log.warn(
        'Mount allowlist not found - additional mounts will be BLOCKED. Create the file to enable additional mounts.',
        { path: MOUNT_ALLOWLIST_PATH },
      );
      return null;
    }

    const content = fs.readFileSync(MOUNT_ALLOWLIST_PATH, 'utf-8');
    const allowlist = JSON.parse(content) as MountAllowlist;

    // Validate structure
    if (!Array.isArray(allowlist.allowedRoots)) {
      throw new Error('allowedRoots must be an array');
    }

    if (!Array.isArray(allowlist.blockedPatterns)) {
      throw new Error('blockedPatterns must be an array');
    }

    // Merge with default blocked patterns
    const mergedBlockedPatterns = [...new Set([...DEFAULT_BLOCKED_PATTERNS, ...allowlist.blockedPatterns])];
    allowlist.blockedPatterns = mergedBlockedPatterns;

    cachedAllowlist = allowlist;
    log.info('Mount allowlist loaded successfully', {
      path: MOUNT_ALLOWLIST_PATH,
      allowedRoots: allowlist.allowedRoots.length,
      blockedPatterns: allowlist.blockedPatterns.length,
    });

    return cachedAllowlist;
  } catch (err) {
    allowlistLoadError = err instanceof Error ? err.message : String(err);
    log.error('Failed to load mount allowlist - additional mounts will be BLOCKED', {
      path: MOUNT_ALLOWLIST_PATH,
      error: allowlistLoadError,
    });
    return null;
  }
}

/**
 * Expand ~ to home directory and resolve to absolute path
 */
function expandPath(p: string): string {
  const homeDir = process.env.HOME || os.homedir();
  if (p.startsWith('~/')) {
    return path.join(homeDir, p.slice(2));
  }
  if (p === '~') {
    return homeDir;
  }
  return path.resolve(p);
}

/**
 * Get the real path, resolving symlinks.
 * Returns null if the path doesn't exist.
 */
function getRealPath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Check if a path matches any blocked pattern
 */
function matchesBlockedPattern(realPath: string, blockedPatterns: string[]): string | null {
  const pathParts = realPath.split(path.sep);

  for (const pattern of blockedPatterns) {
    // Check if any path component matches the pattern
    for (const part of pathParts) {
      if (part === pattern || part.includes(pattern)) {
        return pattern;
      }
    }

    // Also check if the full path contains the pattern
    if (realPath.includes(pattern)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Check if a real path is under an allowed root
 */
function findAllowedRoot(realPath: string, allowedRoots: AllowedRoot[]): AllowedRoot | null {
  for (const root of allowedRoots) {
    const expandedRoot = expandPath(root.path);
    const realRoot = getRealPath(expandedRoot);

    if (realRoot === null) {
      // Allowed root doesn't exist, skip it
      continue;
    }

    // Check if realPath is under realRoot
    const relative = path.relative(realRoot, realPath);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return root;
    }
  }

  return null;
}

/**
 * Validate a relative container path to prevent escaping /workspace/extra/.
 */
function isValidRelativeContainerPath(containerPath: string): boolean {
  // Must not contain .. to prevent path traversal
  if (containerPath.includes('..')) {
    return false;
  }

  // Must not be absolute (it will be prefixed with /workspace/extra/)
  if (containerPath.startsWith('/')) {
    return false;
  }

  // Must not be empty
  if (!containerPath || containerPath.trim() === '') {
    return false;
  }

  // Must not contain colons — prevents Docker -v option injection (e.g., "repo:rw")
  if (containerPath.includes(':')) {
    return false;
  }

  return true;
}

/**
 * Validate an absolute mirror container path.
 *
 * Absolute additional mounts are intentionally narrow: the container path must
 * match the validated host path or a descendant of it. That enables ergonomic
 * host-path parity like /Users/alice -> /Users/alice without allowing an
 * approved host directory to be mounted over arbitrary container locations.
 */
function isValidAbsoluteMirrorContainerPath(containerPath: string, realHostPath: string): boolean {
  if (!path.isAbsolute(containerPath)) return false;
  if (containerPath.includes('\0') || containerPath.includes(':')) return false;

  const normalized = path.normalize(containerPath);
  if (normalized.includes(`..${path.sep}`) || normalized.endsWith(`${path.sep}..`)) return false;

  const relative = path.relative(realHostPath, normalized);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveContainerPath(containerPath: string, realHostPath: string): MountValidationResult {
  if (path.isAbsolute(containerPath)) {
    if (!isValidAbsoluteMirrorContainerPath(containerPath, realHostPath)) {
      return {
        allowed: false,
        reason:
          `Invalid absolute container path: "${containerPath}" - ` +
          `must match the validated host path "${realHostPath}" or one of its descendants`,
      };
    }
    return {
      allowed: true,
      reason: 'absolute mirror path allowed',
      resolvedContainerPath: path.normalize(containerPath),
    };
  }

  if (!isValidRelativeContainerPath(containerPath)) {
    return {
      allowed: false,
      reason: `Invalid container path: "${containerPath}" - must be relative, non-empty, and not contain ".."`,
    };
  }

  return {
    allowed: true,
    reason: 'relative path allowed',
    resolvedContainerPath: `/workspace/extra/${containerPath}`,
  };
}

export interface MountValidationResult {
  allowed: boolean;
  reason: string;
  realHostPath?: string;
  resolvedContainerPath?: string;
  effectiveReadonly?: boolean;
}

/**
 * Validate a single additional mount against the allowlist.
 * Returns validation result with reason.
 */
export function validateMount(mount: AdditionalMount): MountValidationResult {
  const allowlist = loadMountAllowlist();

  // If no allowlist, block all additional mounts
  if (allowlist === null) {
    return {
      allowed: false,
      reason: `No mount allowlist configured at ${MOUNT_ALLOWLIST_PATH}`,
    };
  }

  // Derive containerPath from hostPath basename if not specified.
  const containerPath = mount.containerPath || path.basename(mount.hostPath);

  // Expand and resolve the host path
  const expandedPath = expandPath(mount.hostPath);
  const realPath = getRealPath(expandedPath);

  if (realPath === null) {
    return {
      allowed: false,
      reason: `Host path does not exist: "${mount.hostPath}" (expanded: "${expandedPath}")`,
    };
  }

  const containerPathResult = resolveContainerPath(containerPath, realPath);
  if (!containerPathResult.allowed) return containerPathResult;

  // Check against blocked patterns
  const blockedMatch = matchesBlockedPattern(realPath, allowlist.blockedPatterns);
  if (blockedMatch !== null) {
    return {
      allowed: false,
      reason: `Path matches blocked pattern "${blockedMatch}": "${realPath}"`,
    };
  }

  // Check if under an allowed root
  const allowedRoot = findAllowedRoot(realPath, allowlist.allowedRoots);
  if (allowedRoot === null) {
    return {
      allowed: false,
      reason: `Path "${realPath}" is not under any allowed root. Allowed roots: ${allowlist.allowedRoots
        .map((r) => expandPath(r.path))
        .join(', ')}`,
    };
  }

  // Determine effective readonly status.
  // RW is only granted if the mount explicitly requests it AND the allowed
  // root permits it. Otherwise it's forced read-only.
  const requestedReadWrite = mount.readonly === false;
  let effectiveReadonly = true;

  if (requestedReadWrite) {
    if (!allowedRoot.allowReadWrite) {
      log.info('Mount forced to read-only - root does not allow read-write', {
        mount: mount.hostPath,
        root: allowedRoot.path,
      });
    } else {
      effectiveReadonly = false;
    }
  }

  return {
    allowed: true,
    reason: `Allowed under root "${allowedRoot.path}"${allowedRoot.description ? ` (${allowedRoot.description})` : ''}`,
    realHostPath: realPath,
    resolvedContainerPath: containerPathResult.resolvedContainerPath,
    effectiveReadonly,
  };
}

/**
 * Validate all additional mounts for a group.
 * Returns array of validated mounts (only those that passed validation).
 * Logs warnings for rejected mounts.
 */
export function validateAdditionalMounts(
  mounts: AdditionalMount[],
  groupName: string,
): Array<{
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}> {
  const validatedMounts: Array<{
    hostPath: string;
    containerPath: string;
    readonly: boolean;
  }> = [];

  for (const mount of mounts) {
    const result = validateMount(mount);

    if (result.allowed) {
      validatedMounts.push({
        hostPath: result.realHostPath!,
        containerPath: result.resolvedContainerPath!,
        readonly: result.effectiveReadonly!,
      });

      log.debug('Mount validated successfully', {
        group: groupName,
        hostPath: result.realHostPath,
        containerPath: result.resolvedContainerPath,
        readonly: result.effectiveReadonly,
        reason: result.reason,
      });
    } else {
      log.warn('Additional mount REJECTED', {
        group: groupName,
        requestedPath: mount.hostPath,
        containerPath: mount.containerPath,
        reason: result.reason,
      });
    }
  }

  return validatedMounts;
}

/**
 * Generate a template allowlist file for users to customize
 */
export function generateAllowlistTemplate(): string {
  const template: MountAllowlist = {
    allowedRoots: [
      {
        path: '~/projects',
        allowReadWrite: true,
        description: 'Development projects',
      },
      {
        path: '~/repos',
        allowReadWrite: true,
        description: 'Git repositories',
      },
      {
        path: '~/Documents/work',
        allowReadWrite: false,
        description: 'Work documents (read-only)',
      },
    ],
    blockedPatterns: [
      // Additional patterns beyond defaults
      'password',
      'secret',
      'token',
    ],
  };

  return JSON.stringify(template, null, 2);
}
