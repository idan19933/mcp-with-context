/**
 * Metadata Service
 * Handles discovery and caching of Clarity object metadata
 */

import type {
  ObjectMetadata,
  AttributeMetadata,
  ObjectDescriptor,
} from '../types/clarity.js';

import { ClarityApiClient } from './ClarityApiClient.js';

import {
  CACHE_TTL,
  STANDARD_OBJECTS,
  PRIORITY_FIELDS,
  EXCLUDED_DATA_TYPES,
} from '../constants.js';

export class MetadataService {
  private readonly client: ClarityApiClient;
  
  // Caches
  private readonly metadataCache = new Map<string, ObjectMetadata>();
  private readonly objectLabelsCache = new Map<string, string>();
  private readonly labelToResourceCache = new Map<string, string>();
  
  // Discovery cache
  private discoveredObjects: string[] | null = null;
  private discoveredObjectsTimestamp = 0;
  private customObjectsCache: Array<{ label: string; resourceName: string }> | null = null;

  constructor(client: ClarityApiClient) {
    this.client = client;
  }

  async discoverAllObjects(forceRefresh = false): Promise<string[]> {
    const now = Date.now();

    if (
      !forceRefresh &&
      this.discoveredObjects &&
      now - this.discoveredObjectsTimestamp < CACHE_TTL.DISCOVERED_OBJECTS
    ) {
      return this.discoveredObjects;
    }

    console.log('[MetadataService] Discovering all objects...');

    try {
      const allObjectsResponse = await this.client.get<ObjectDescriptor>(
        '/describe?limit=500'
      );

      const customObjectsResponse = await this.client.get<ObjectDescriptor>(
        '/describe?filter=(isCustom = true) and (isSystem = false)&limit=500'
      );

      const objectNames = new Set<string>();

      for (const obj of allObjectsResponse._results ?? []) {
        const typedObj = obj as { resourceName?: string; label?: string };
        if (typedObj.resourceName) {
          objectNames.add(typedObj.resourceName);
          if (typedObj.label) {
            this.objectLabelsCache.set(typedObj.resourceName, typedObj.label);
            this.labelToResourceCache.set(typedObj.label.toLowerCase(), typedObj.resourceName);
          }
        }
      }

      // Cache custom objects
      this.customObjectsCache = (customObjectsResponse._results ?? [])
        .filter((obj): obj is { resourceName: string; label: string } => {
          const typedObj = obj as { resourceName?: string; label?: string };
          return !!typedObj.resourceName && !!typedObj.label;
        })
        .map(obj => ({ label: obj.label, resourceName: obj.resourceName }));

      for (const obj of STANDARD_OBJECTS) {
        objectNames.add(obj);
      }

      this.discoveredObjects = Array.from(objectNames);
      this.discoveredObjectsTimestamp = now;

      console.log(`[MetadataService] Discovered ${this.discoveredObjects.length} objects`);

      return this.discoveredObjects;
    } catch (error) {
      console.error('[MetadataService] Discovery failed:', error);
      this.discoveredObjects = STANDARD_OBJECTS;
      this.discoveredObjectsTimestamp = now;
      return this.discoveredObjects;
    }
  }

  async getCustomObjects(): Promise<Array<{ label: string; resourceName: string }>> {
    if (this.customObjectsCache) {
      return this.customObjectsCache;
    }

    await this.discoverAllObjects();
    return this.customObjectsCache ?? [];
  }

  async getObjectMetadata(objectType: string): Promise<ObjectMetadata> {
    if (this.metadataCache.has(objectType)) {
      return this.metadataCache.get(objectType)!;
    }

    console.log(`[MetadataService] Fetching metadata for ${objectType}...`);

    try {
      const response = await this.client.get<Record<string, unknown>>(
        `/describe/${objectType}?includeAttributes=true`
      );

      const attributes: AttributeMetadata[] = [];
      const rawAttributes = (response['attributes'] ?? response['_results'] ?? []) as Array<Record<string, unknown>>;

      // Debug: log first attribute to see structure
      if (rawAttributes.length > 0) {
        console.log(`[MetadataService] Sample attribute keys:`, Object.keys(rawAttributes[0] ?? {}));
      }

      for (const attr of rawAttributes) {
        const dataType = String(attr['dataType'] ?? 'STRING');
        
        if (EXCLUDED_DATA_TYPES.includes(dataType)) {
          continue;
        }

        // Clarity API returns 'name' for the API name, not 'attributeName'
        const apiName = String(
          attr['name'] ?? 
          attr['attributeName'] ?? 
          attr['apiName'] ?? 
          attr['code'] ?? 
          ''
        );
        
        const displayName = String(
          attr['displayName'] ?? 
          attr['label'] ?? 
          attr['name'] ?? 
          ''
        );

        // Skip if no apiName
        if (!apiName) {
          continue;
        }

        attributes.push({
          apiName,
          displayName: displayName || apiName,
          dataType,
          isRequired: Boolean(attr['isRequired']),
          isReadOnly: Boolean(attr['isReadOnly']),
          isLookup: Boolean(attr['isLookup'] || attr['lookupType']),
          lookupType: attr['lookupType'] as string | undefined,
          maxLength: attr['maxLength'] as number | undefined,
          precision: attr['precision'] as number | undefined,
          scale: attr['scale'] as number | undefined,
        });
      }

      const metadata: ObjectMetadata = {
        resourceName: objectType,
        label: String(response['label'] ?? objectType),
        pluralLabel: String(response['pluralLabel'] ?? response['label'] ?? objectType),
        isCustom: Boolean(response['isCustom']),
        attributes,
      };

      this.metadataCache.set(objectType, metadata);
      this.objectLabelsCache.set(objectType, metadata.label);

      console.log(`[MetadataService] Loaded ${attributes.length} attributes for ${objectType}`);

      return metadata;
    } catch (error) {
      console.error(`[MetadataService] Failed to get metadata for ${objectType}:`, error);
      throw error;
    }
  }

  async getObjectLabel(objectType: string): Promise<string> {
    if (this.objectLabelsCache.has(objectType)) {
      return this.objectLabelsCache.get(objectType)!;
    }

    try {
      const metadata = await this.getObjectMetadata(objectType);
      return metadata.pluralLabel || metadata.label || objectType;
    } catch {
      return objectType;
    }
  }

  getGroupableFields(metadata: ObjectMetadata): AttributeMetadata[] {
    const validTypes = ['STRING', 'LOOKUP', 'BOOLEAN', 'NUMBER', 'INTEGER'];
    
    return metadata.attributes
      .filter(attr => {
        if (attr.apiName.startsWith('_') && attr.apiName !== '_internalId') return false;
        if (attr.isReadOnly && !attr.isLookup) return false;
        if (!validTypes.includes(attr.dataType) && !attr.isLookup) return false;
        return true;
      })
      .sort((a, b) => {
        const aPriority = PRIORITY_FIELDS.indexOf(a.apiName);
        const bPriority = PRIORITY_FIELDS.indexOf(b.apiName);
        
        if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
        if (aPriority !== -1) return -1;
        if (bPriority !== -1) return 1;
        if (a.isLookup && !b.isLookup) return -1;
        if (!a.isLookup && b.isLookup) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }

  resolveObjectName(nameOrLabel: string): string | null {
    const lower = nameOrLabel.toLowerCase();
    
    if (this.discoveredObjects?.includes(nameOrLabel)) {
      return nameOrLabel;
    }
    
    if (this.labelToResourceCache.has(lower)) {
      return this.labelToResourceCache.get(lower)!;
    }
    
    for (const [label, resource] of this.labelToResourceCache) {
      if (label.includes(lower) || lower.includes(label)) {
        return resource;
      }
    }
    
    return null;
  }
}
