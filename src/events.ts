import events, { EventSubscription } from "@mongez/events";
import { EndpointEventsInterface, HttpEvent } from "./types";

const BASE_EVENT_KEY = "endpoint.";

const event = (eventName: HttpEvent): string => BASE_EVENT_KEY + eventName;

const endpointEvents: EndpointEventsInterface = {
  beforeSending: (callback): EventSubscription => {
    return events.subscribe(event("sending"), callback);
  },
  onResponse: (callback): EventSubscription => {
    return events.subscribe(event("send"), callback as any);
  },
  onSuccess: (callback): EventSubscription => {
    return events.subscribe(event("success"), callback as any);
  },
  onError: (callback): EventSubscription => {
    return events.subscribe(event("error"), callback as any);
  },
  trigger: (eventName: HttpEvent, ...args: any[]): void => {
    events.trigger(event(eventName), ...args);
  },
};

export default endpointEvents;
