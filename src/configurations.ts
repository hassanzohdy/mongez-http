import { Obj } from "@mongez/reinforcements";
import { HttpConfigurations } from "./types";
import { serialize } from "./utils";

const defaultConfigurations: HttpConfigurations = {
  baseUrl: "",
  putToPost: false,
  putMethodKey: "_method",
  formDataToJSON: false,
  formDataToJSONSerializer: serialize,
};

let currentConfigurations: HttpConfigurations = { ...defaultConfigurations };

/**
 * Set http configurations, this will override any previous configurations or merge with new onces
 * @param configurations
 */
export function setHttpConfigurations(
  configurations: HttpConfigurations
): void {
  currentConfigurations = Obj.merge(currentConfigurations, configurations);
}

export function getHttpConfigurations(): HttpConfigurations {
  return currentConfigurations;
}

export function getHttpConfig(
  key: keyof HttpConfigurations,
  defaultValue: any
): any {
  return Obj.get(currentConfigurations, key, defaultValue);
}
