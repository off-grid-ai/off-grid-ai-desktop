import { systemPreferences, shell, desktopCapturer } from 'electron';

export interface PermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
  allGranted: boolean;
}

/**
 * Check if the app has Accessibility permission on macOS.
 * This permission is required for the watcher to read window content.
 */
function checkAccessibilityPermission(prompt: boolean = false): boolean {
  if (process.platform !== 'darwin') {
    return true; // Not applicable on other platforms
  }
  return systemPreferences.isTrustedAccessibilityClient(prompt);
}

/**
 * Check if the app has Screen Recording permission on macOS.
 * This permission is required for desktopCapturer to capture window screenshots.
 */
function checkScreenRecordingPermission(): boolean {
  if (process.platform !== 'darwin') {
    return true; // Not applicable on other platforms
  }
  
  // On macOS, we check screen recording access via getMediaAccessStatus
  const status = systemPreferences.getMediaAccessStatus('screen');
  console.log('[permissions] Screen recording status:', status);
  return status === 'granted';
}

/**
 * Get the status of all required permissions.
 */
export function getPermissionStatus(): PermissionStatus {
  const accessibility = checkAccessibilityPermission(false);
  const screenRecording = checkScreenRecordingPermission();
  
  console.log('[permissions] Status check - Accessibility:', accessibility, 'Screen Recording:', screenRecording);
  
  return {
    accessibility,
    screenRecording,
    allGranted: accessibility && screenRecording
  };
}

/**
 * Request Accessibility permission (shows system prompt on macOS).
 * Returns current status - user must grant manually in System Preferences.
 */
export function requestAccessibilityPermission(): boolean {
  if (process.platform !== 'darwin') {
    return true;
  }
  // Passing true triggers the system dialog if not already trusted
  return systemPreferences.isTrustedAccessibilityClient(true);
}

/**
 * Open System Preferences to the appropriate pane for granting permissions.
 */
export function openAccessibilitySettings(): void {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  }
}

export function openScreenRecordingSettings(): void {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
}

/**
 * Trigger the screen recording permission prompt by attempting to use desktopCapturer.
 * This will cause macOS to add the app to the Screen Recording list.
 */
export async function requestScreenRecordingPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }
  
  try {
    // Attempting to get sources triggers the permission prompt
    // macOS will then add the app to the Screen Recording permissions list
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    
    // Check if permission was granted
    const status = systemPreferences.getMediaAccessStatus('screen');
    return status === 'granted';
  } catch (e) {
    console.error('Failed to request screen recording permission:', e);
    return false;
  }
}
