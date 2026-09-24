/// <reference types="vite/client" />

interface DirectoryPickerHandle {
  name: string;
}

declare global {
  var showDirectoryPicker: (() => Promise<DirectoryPickerHandle>) | undefined;
}

export {};
