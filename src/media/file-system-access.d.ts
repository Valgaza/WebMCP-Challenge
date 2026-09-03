/**
 * The File System Access permission methods and the directory/file pickers are Chromium
 * extensions that TypeScript's DOM lib does not yet declare. Estro capability-detects each
 * one at runtime; these declarations only describe the shape when it is present.
 */
type FileSystemPermissionState = "granted" | "denied" | "prompt";

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<FileSystemPermissionState>;
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
}

interface Window {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}
