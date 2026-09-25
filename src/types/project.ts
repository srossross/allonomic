export interface Project {
  id: string;
  name: string;
  path: string;
  containerId?: string | null;
  devcontainerStatus?: "running" | "stopped" | "not_setup";
}
