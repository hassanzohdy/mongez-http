import { Endpoint } from './Endpoint';

let currentEndpoint: Endpoint;

export function setCurrentEndpoint(endpoint: Endpoint): void {
  currentEndpoint = endpoint;
}

export function getCurrentEndpoint(): Endpoint {
  return currentEndpoint;
}

export const lastRequest = (): AbortController | undefined => currentEndpoint.getLastRequest();
