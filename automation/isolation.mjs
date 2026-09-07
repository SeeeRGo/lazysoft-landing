// Codex's inner filesystem/network sandbox remains authoritative. Docker permits
// creation of its unprivileged namespaces while retaining a read-only root,
// no-new-privileges and no capabilities (set by worker.mjs).
export const nestedContainerArgs = ["--security-opt=seccomp=unconfined", "--security-opt=apparmor=unconfined"];
export const sandboxConfigArgs = [
  "-c", 'default_permissions="request-worker"',
  "-c", 'permissions.request-worker.filesystem={"/"="read","/workspace"="write","/output"="write","/tmp"="write","/home/node/.codex"="deny"}',
  "-c", 'permissions.request-worker.network.enabled=false',
];
