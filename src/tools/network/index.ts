import type { ToolDefinition } from "../../types/index.js";
import { httpRequest } from "./httpRequest.js";
import { ping } from "./ping.js";
import { dnsLookup } from "./dnsLookup.js";
import { portScan } from "./portScan.js";
import { portPid } from "./portPid.js";
import { whois } from "./whois.js";
import { traceroute } from "./traceroute.js";
import { downloadFile } from "./downloadFile.js";
import { checkConnectivity } from "./checkConnectivity.js";

export const networkTools: ToolDefinition[] = [
  httpRequest,
  ping,
  dnsLookup,
  portScan,
  portPid,
  whois,
  traceroute,
  downloadFile,
  checkConnectivity,
];
