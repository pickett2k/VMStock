/**
 * Date utilities for consistent UK date/time formatting
 */

/**
 * Format date to UK locale with date and time
 * @param date - Date string, number, or Date object
 * @returns Formatted string like "07/10/2025, 17:30:15"
 */
export function formatUKDateTime(date: string | number | Date): string {
  try {
    const dateObj = new Date(date);
    
    if (isNaN(dateObj.getTime())) {
      return 'Invalid Date';
    }

    return dateObj.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false // Use 24-hour format
    });
  } catch (error) {
    console.warn('Date formatting error:', error);
    return String(date);
  }
}

/**
 * Format date to UK locale date only
 * @param date - Date string, number, or Date object  
 * @returns Formatted string like "07/10/2025"
 */
export function formatUKDate(date: string | number | Date): string {
  try {
    const dateObj = new Date(date);
    
    if (isNaN(dateObj.getTime())) {
      return 'Invalid Date';
    }

    return dateObj.toLocaleDateString('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch (error) {
    console.warn('Date formatting error:', error);
    return String(date);
  }
}

/**
 * Format time to UK locale time only
 * @param date - Date string, number, or Date object
 * @returns Formatted string like "17:30:15"
 */
export function formatUKTime(date: string | number | Date): string {
  try {
    const dateObj = new Date(date);
    
    if (isNaN(dateObj.getTime())) {
      return 'Invalid Time';
    }

    return dateObj.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false // Use 24-hour format
    });
  } catch (error) {
    console.warn('Time formatting error:', error);
    return String(date);
  }
}

/**
 * Format relative time (e.g., "2 minutes ago")
 * @param date - Date string, number, or Date object
 * @returns Formatted string like "2 minutes ago" or "just now"
 */
export function formatRelativeTime(date: string | number | Date): string {
  try {
    const dateObj = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    // For older dates, show actual date
    return formatUKDate(date);
  } catch (error) {
    console.warn('Relative time formatting error:', error);
    return formatUKDateTime(date);
  }
}