import Endpoint from "./Endpoint";

let currentEndpoint: Endpoint;

export function setCurrentEndpoint(endpoint: Endpoint) {
  currentEndpoint = endpoint;
}

export function getCurrentEndpoint(): Endpoint {
  return currentEndpoint;
}

export const lastRequest = () => currentEndpoint.getLastRequest();
