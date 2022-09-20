import events, { EventSubscription } from "@mongez/events";
import { Obj, Random } from "@mongez/reinforcements";
import Is from "@mongez/supportive-is";
import { Axios, AxiosRequestConfig, AxiosResponse } from "axios";
import { EndpointConfigurations, EndpointEvent } from "./Endpoint.types";

export default class Endpoint extends Axios {
  /**
   * Last request controller
   */
  public lastRequest?: AbortController;

  /**
   * Default configurations
   */
  protected defaultConfigurations: EndpointConfigurations = {
    putToPost: false,
    putMethodKey: "_method",
  };

  /**
   * Endpoint id
   */
  protected endpointId = Random.id();

  /**
   * Endpoint event namespace
   */
  protected eventNamespace = `endpoint.${this.endpointId}`;

  /**
   * Constructor
   */
  public constructor(public configurations: EndpointConfigurations = {}) {
    super(configurations);

    this.configurations = Obj.merge(this.defaultConfigurations, configurations);

    this.boot();
  }

  /**
   * Set endpoint configurations
   */
  public setConfigurations(configurations: EndpointConfigurations) {
    this.configurations = Obj.merge(this.configurations, configurations);

    this.defaults = this.configurations as any;
  }

  /**
   * Boot the endpoint
   */
  protected boot() {
    this.addInterceptors();
  }

  /**
   * Add axios interceptors
   */
  protected addInterceptors() {
    this.addRequestInterceptors();
    this.addResponseInterceptors();
  }

  /**
   * Add request interceptors
   */
  protected addRequestInterceptors() {
    this.interceptors.request.use((requestConfig: AxiosRequestConfig) => {
      // A workaround for put requests to be sent as post request
      // this will allow us to upload images
      const headers = requestConfig.headers || {};

      const isPutRequest = requestConfig.method?.toUpperCase() === "PUT";

      let data = requestConfig.data;

      if (Is.formElement(data)) {
        data = new FormData(data);
      }

      if (isPutRequest && this.configurations.putToPost) {
        requestConfig.method = "POST";
        if (Is.formData(data)) {
          data.append(this.configurations.putMethodKey, "PUT");
        } else if (Is.plainObject(data) && this.configurations.putMethodKey) {
          data = Obj.set(data, this.configurations.putMethodKey, "PUT");
        }
      }

      if (Is.plainObject(data)) {
        headers!["Content-Type"] = "Application/json";

        data = JSON.stringify(data);
      }

      requestConfig.data = data;

      const authHeader = this.configurations.setAuthorizationHeader;

      if (authHeader && !headers?.Authorization) {
        headers.Authorization =
          typeof authHeader === "function"
            ? authHeader(requestConfig)
            : authHeader;
      }

      requestConfig.headers = headers;

      this.lastRequest = new AbortController();

      requestConfig.signal = this.lastRequest.signal;

      // trigger event of sending ajax request
      this.trigger("sending", requestConfig);

      return requestConfig;
    });
  }

  /**
   * Get endpoint last request
   */
  public getLastRequest() {
    return this.lastRequest;
  }

  /**
   * Add response interceptors
   */
  protected addResponseInterceptors() {
    this.interceptors.response.use(
      (response) => {
        try {
          response.data = JSON.parse(response.data);
        } catch {}

        this.lastRequest = undefined;
        this.trigger("complete", response);
        this.trigger("success", response);

        return response;
      },
      (error) => {
        if (error?.response?.data) {
          try {
            error.response.data = JSON.parse(error.response.data);
          } catch {}
        }

        this.lastRequest = undefined;
        this.trigger("complete", error.response);
        this.trigger("error", error.response);

        return Promise.reject(error);
      }
    );
  }

  /**
   * Get events subscribers
   */
  public get events() {
    return {
      /**
       * Triggered when response is returned with error response
       */
      onError: (
        callback: (response: AxiosResponse) => void
      ): EventSubscription => {
        return events.subscribe(`${this.eventNamespace}.error`, callback);
      },
      /**
       * Triggered when response is returned with success response
       */
      onSuccess: (
        callback: (response: AxiosResponse) => void
      ): EventSubscription => {
        return events.subscribe(`${this.eventNamespace}.success`, callback);
      },
      /**
       * Triggered when response is returned wether it is success or error response
       */
      onComplete: (
        callback: (response: AxiosResponse) => void
      ): EventSubscription => {
        return events.subscribe(`${this.eventNamespace}.complete`, callback);
      },
      /**
       * Triggered before sending response
       */
      beforeSending: (
        callback: (config: AxiosRequestConfig) => void
      ): EventSubscription => {
        return events.subscribe(`${this.eventNamespace}.sending`, callback);
      },
    };
  }

  /**
   * Trigger the given event
   */
  protected trigger(event: EndpointEvent, ...args: any[]) {
    return events.trigger(`${this.eventNamespace}.${event}`, ...args);
  }
}
