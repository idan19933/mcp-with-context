/**
 * Clarity PPM Type Definitions
 */

export interface ObjectMetadata {
  resourceName: string;
  label: string;
  pluralLabel: string;
  isCustom: boolean;
  attributes: AttributeMetadata[];
}

export interface AttributeMetadata {
  apiName: string;
  displayName: string;
  dataType: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isLookup: boolean;
  lookupType?: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
}

export interface ObjectDescriptor {
  _results?: Array<{
    resourceName?: string;
    label?: string;
    pluralLabel?: string;
    isCustom?: boolean;
  }>;
}

export interface LookupValue {
  code: string;
  displayValue: string;
}

export interface ClarityConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  sessionId?: string;
  authToken?: string;
  timeout?: number;
  maxRetries?: number;
}
