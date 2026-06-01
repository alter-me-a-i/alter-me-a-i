/*
 * Default sensitivity classifier for captured events. Conservative by design:
 * ordinary behavior is 'personal' (included in training by default), while
 * anything from a sensitive host is bumped to 'sensitive' (excluded by default).
 * The user can always re-tag later; this just sets a safe floor at capture time.
 */

import type { EventType, Sensitivity } from '../vault/types';
import { isSensitiveHost } from './hosts';

export function classify(host: string, _kind: EventType): Sensitivity {
  if (isSensitiveHost(host)) return 'sensitive';
  return 'personal';
}
