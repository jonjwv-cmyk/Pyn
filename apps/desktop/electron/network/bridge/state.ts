let bridgeProxyEndpoint: { host: string; port: number } | null = null;

export function getBridgeProxyEndpoint(): { host: string; port: number } | null {
  return bridgeProxyEndpoint;
}

export function setBridgeProxyEndpoint(endpoint: { host: string; port: number } | null): void {
  bridgeProxyEndpoint = endpoint;
}
