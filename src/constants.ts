/**
 * Constants for Clarity MCP Server
 */

export const CACHE_TTL = {
  METADATA: 30 * 60 * 1000,        // 30 minutes
  LOOKUPS: 60 * 60 * 1000,         // 1 hour
  DISCOVERED_OBJECTS: 60 * 60 * 1000, // 1 hour
};

export const STANDARD_OBJECTS = [
  'projects',
  'tasks',
  'resources',
  'ideas',
  'risks',
  'issues',
  'timesheets',
  'assignments',
  'investments',
  'costPlans',
  'benefitPlans',
  'budgetPlans',
];

export const PRIORITY_FIELDS = [
  'status',
  'name',
  'code',
  'manager',
  'owner',
  'priority',
  'department',
  'startDate',
  'finishDate',
  'percentComplete',
];

export const EXCLUDED_DATA_TYPES = [
  'LARGE_STRING',
  'ATTACHMENT',
  'BINARY',
  'BLOB',
];

export const DEFAULT_SMART_FIELD_COUNT = 20;
