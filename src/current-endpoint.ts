import Endpoint from "./Endpoint";

export let currentEndpoint: Endpoint;

export function setCurrentEndpoint(endpoint: Endpoint) {
  currentEndpoint = endpoint;
}

export function getCurrentEndpoint(): Endpoint {
  return currentEndpoint;
}
