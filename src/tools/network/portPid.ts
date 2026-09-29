import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { ToolDefinition } from "../../types/index.js";
import { ok } from "../../utils/response.js";
import { childLogger } from "../../logger.js";

const log = childLogger("network");

// Reads /proc/net/tcp or /proc/net/tcp6 and returns a map of port -> inode
// for sockets in LISTEN state (state=0A).
function parseNetTcp(file: string): Map<number, number> {
  const portToInode = new Map<number, number>();
  try {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const localAddr = parts[1];
      const state = parts[3];
      const inode = parseInt(parts[9], 10);
      if (state !== "0A") continue; // 0A = TCP_LISTEN
      const portHex = localAddr.split(":")[1];
      const port = parseInt(portHex, 16);
      portToInode.set(port, inode);
    }
  } catch {
    // file may not exist or be unreadable in this environment
  }
  return portToInode;
}

// Walks /proc/[pid]/fd symlinks to find which PID owns a given socket inode.
function findPidForInode(inode: number): { pid: number; comm: string } | null {
  let procEntries: string[];
  try {
    procEntries = fs.readdirSync("/proc");
  } catch {
    return null;
  }

  for (const entry of procEntries) {
    const pid = parseInt(entry, 10);
    if (isNaN(pid)) continue;

    const fdDir = `/proc/${pid}/fd`;
    let fds: string[];
    try {
      fds = fs.readdirSync(fdDir);
    } catch {
      continue;
    }

    for (const fd of fds) {
      try {
        const link = fs.readlinkSync(path.join(fdDir, fd));
        if (link === `socket:[${inode}]`) {
          let comm = "unknown";
          try {
            comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
          } catch {
            // comm may not be readable
          }
          return { pid, comm };
        }
      } catch {
        // fd may have been closed between readdirSync and readlinkSync
      }
    }
  }

  return null;
}

export const portPid: ToolDefinition = {
  name: "port_pid",
  description:
    "Get the PID and process name for processes listening on specific TCP ports. " +
    "Works natively without a shell by reading /proc/net/tcp directly — " +
    "use this when lsof or ss are unavailable.",
  schema: {
    ports: z.array(z.number()).describe("TCP ports to look up, e.g. [3000, 8080]"),
  },
  handler: async ({ ports }) => {
    log.info("Looking up port-to-PID mapping", { ports });

    const portToInode = new Map<number, number>();
    for (const [port, inode] of parseNetTcp("/proc/net/tcp")) {
      portToInode.set(port, inode);
    }
    for (const [port, inode] of parseNetTcp("/proc/net/tcp6")) {
      if (!portToInode.has(port)) portToInode.set(port, inode);
    }

    const lines: string[] = [];
    for (const port of ports) {
      const inode = portToInode.get(port);
      if (inode === undefined) {
        lines.push(`  ${String(port).padStart(5)}: nothing listening`);
        continue;
      }
      const proc = findPidForInode(inode);
      if (!proc) {
        lines.push(`  ${String(port).padStart(5)}: inode ${inode} — process not found (may need elevated permissions)`);
      } else {
        lines.push(`  ${String(port).padStart(5)}: PID ${proc.pid}  (${proc.comm})`);
      }
    }

    return ok(`Port-to-PID mapping:\n${lines.join("\n")}`);
  },
};
