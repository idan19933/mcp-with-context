/**
 * Deep Link Service
 * Generates URLs to Clarity PPM pages with filters
 * 
 * URL Formats:
 * - All projects: /pm/#/projects/common
 * - Specific project: /pm/#/project/{id}/tasks
 * - Project conversations: /pm/#/project/{id}/conversation
 * - Custom objects list: /pm/#/customobjects/{objectCode}/common
 * - Specific custom object: /pm/#/customobjects/{objectCode}/{id}
 */

export class DeepLinkService {
  private clarityBaseUrl: string;

  constructor(clarityBaseUrl: string) {
    // Extract base URL without /ppm/rest/v1
    // Input: http://16.16.83.171/ppm/rest/v1
    // Output: http://16.16.83.171
    this.clarityBaseUrl = clarityBaseUrl
      .replace(/\/ppm\/rest\/v1\/?$/, '')
      .replace(/\/$/, '');
  }

  /**
   * Generate a link to an object list page
   */
  generateListLink(objectType: string): string {
    // Check if it's a custom object (starts with 'cust')
    if (this.isCustomObject(objectType)) {
      return `${this.clarityBaseUrl}/pm/#/customobjects/${objectType}/common`;
    }
    
    // Standard objects
    const pathMap: Record<string, string> = {
      'projects': 'projects/common',
      'tasks': 'tasks/common',
      'resources': 'resources/common',
      'ideas': 'ideas/common',
      'risks': 'risks/common',
      'issues': 'issues/common',
      'timesheets': 'timesheets/common',
    };
    
    const path = pathMap[objectType.toLowerCase()] ?? `${objectType}/common`;
    return `${this.clarityBaseUrl}/pm/#/${path}`;
  }

  /**
   * Generate a link to a specific record
   */
  generateRecordLink(objectType: string, recordId: string | number, tab: string = 'properties'): string {
    // Custom objects
    if (this.isCustomObject(objectType)) {
      return `${this.clarityBaseUrl}/pm/#/customobjects/${objectType}/${recordId}`;
    }
    
    // Projects - singular 'project' in URL
    if (objectType.toLowerCase() === 'projects') {
      return `${this.clarityBaseUrl}/pm/#/project/${recordId}/${tab}`;
    }
    
    // Other standard objects
    const singularMap: Record<string, string> = {
      'tasks': 'task',
      'resources': 'resource',
      'ideas': 'idea',
      'risks': 'risk',
      'issues': 'issue',
    };
    
    const singular = singularMap[objectType.toLowerCase()] ?? objectType;
    return `${this.clarityBaseUrl}/pm/#/${singular}/${recordId}/${tab}`;
  }

  /**
   * Generate a link to project tasks
   */
  generateProjectTasksLink(projectId: string | number): string {
    return `${this.clarityBaseUrl}/pm/#/project/${projectId}/tasks`;
  }

  /**
   * Generate a link to project conversations
   */
  generateProjectConversationLink(projectId: string | number): string {
    return `${this.clarityBaseUrl}/pm/#/project/${projectId}/conversation`;
  }

  /**
   * Generate a link with a filter applied
   */
  generateFilteredLink(
    objectType: string, 
    field: string, 
    value: string
  ): string {
    const baseUrl = this.generateListLink(objectType);
    const filter = encodeURIComponent(`${field}=${value}`);
    return `${baseUrl}?filter=${filter}`;
  }

  /**
   * Generate a link with multiple filters
   */
  generateMultiFilterLink(
    objectType: string,
    filters: Record<string, string>
  ): string {
    const baseUrl = this.generateListLink(objectType);
    const filterParts = Object.entries(filters)
      .map(([field, value]) => `${field}=${value}`)
      .join('&');
    
    const encodedFilter = encodeURIComponent(filterParts);
    return `${baseUrl}?filter=${encodedFilter}`;
  }

  /**
   * Generate a link to create a new record
   */
  generateCreateLink(objectType: string): string {
    if (this.isCustomObject(objectType)) {
      return `${this.clarityBaseUrl}/pm/#/customobjects/${objectType}/new`;
    }
    return `${this.clarityBaseUrl}/pm/#/${objectType}/new`;
  }

  /**
   * Check if object type is a custom object
   */
  private isCustomObject(objectType: string): boolean {
    return objectType.toLowerCase().startsWith('cust');
  }

  /**
   * Parse a Clarity URL to extract object type and record ID
   */
  parseUrl(url: string): { objectType: string; recordId?: string } | null {
    try {
      // Match custom objects: /pm/#/customobjects/{objectCode}/{id}
      const customMatch = url.match(/\/pm\/#\/customobjects\/([^/?]+)(?:\/(\d+|common))?/);
      if (customMatch) {
        return {
          objectType: customMatch[1] ?? '',
          recordId: customMatch[2] !== 'common' ? customMatch[2] : undefined,
        };
      }
      
      // Match standard objects: /pm/#/project/{id}/tasks or /pm/#/projects/common
      const standardMatch = url.match(/\/pm\/#\/([^/?]+)(?:\/(\d+|common))?/);
      if (standardMatch) {
        return {
          objectType: standardMatch[1] ?? '',
          recordId: standardMatch[2] !== 'common' ? standardMatch[2] : undefined,
        };
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Generate markdown link for display
   */
  generateMarkdownLink(text: string, url: string): string {
    return `[${text}](${url})`;
  }

  /**
   * Generate a complete drill-down link with nice formatting
   */
  generateDrillDownLink(
    objectType: string,
    objectLabel: string,
    field: string,
    fieldDisplayName: string,
    value: string
  ): string {
    const url = this.generateFilteredLink(objectType, field, value);
    const linkText = `${objectLabel} where ${fieldDisplayName} = "${value}"`;
    return this.generateMarkdownLink(linkText, url);
  }

  /**
   * Get base URL for display
   */
  getBaseUrl(): string {
    return this.clarityBaseUrl;
  }
}
