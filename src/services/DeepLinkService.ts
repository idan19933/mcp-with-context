/**
 * Deep Link Service
 * Generates URLs to Clarity PPM pages with filters
 */

export class DeepLinkService {
  private clarityBaseUrl: string;

  constructor(clarityBaseUrl: string) {
    // Remove trailing slash if present
    this.clarityBaseUrl = clarityBaseUrl.replace(/\/$/, '');
  }

  /**
   * Generate a link to an object list page
   */
  generateListLink(objectType: string): string {
    return `${this.clarityBaseUrl}/pm/#/${this.getObjectPath(objectType)}`;
  }

  /**
   * Generate a link to a specific record
   */
  generateRecordLink(objectType: string, recordId: string | number): string {
    return `${this.clarityBaseUrl}/pm/#/${this.getObjectPath(objectType)}/${recordId}`;
  }

  /**
   * Generate a link with a filter applied
   * Note: Clarity's filter URL format may vary by version
   */
  generateFilteredLink(
    objectType: string, 
    field: string, 
    value: string
  ): string {
    // URL encode the filter
    const filter = encodeURIComponent(`${field}=${value}`);
    return `${this.clarityBaseUrl}/pm/#/${this.getObjectPath(objectType)}?filter=${filter}`;
  }

  /**
   * Generate a link with multiple filters
   */
  generateMultiFilterLink(
    objectType: string,
    filters: Record<string, string>
  ): string {
    const filterParts = Object.entries(filters)
      .map(([field, value]) => `${field}=${value}`)
      .join('&');
    
    const encodedFilter = encodeURIComponent(filterParts);
    return `${this.clarityBaseUrl}/pm/#/${this.getObjectPath(objectType)}?filter=${encodedFilter}`;
  }

  /**
   * Generate a link to create a new record
   */
  generateCreateLink(objectType: string): string {
    return `${this.clarityBaseUrl}/pm/#/${this.getObjectPath(objectType)}/new`;
  }

  /**
   * Get the URL path for an object type
   */
  private getObjectPath(objectType: string): string {
    // Map common object types to their URL paths
    const pathMap: Record<string, string> = {
      'projects': 'projects',
      'tasks': 'tasks',
      'resources': 'resources',
      'ideas': 'ideas',
      'risks': 'risks',
      'issues': 'issues',
      'timesheets': 'timesheets',
      'assignments': 'assignments',
    };

    return pathMap[objectType.toLowerCase()] ?? objectType;
  }

  /**
   * Parse a Clarity URL to extract object type and record ID
   */
  parseUrl(url: string): { objectType: string; recordId?: string } | null {
    try {
      // Match patterns like /pm/#/projects/12345 or /pm/#/projects
      const match = url.match(/\/pm\/#\/([^/?]+)(?:\/(\d+))?/);
      
      if (match) {
        return {
          objectType: match[1] ?? '',
          recordId: match[2],
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
}
