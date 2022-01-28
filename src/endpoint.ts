import endpointEvents from "./events";
import Is from "@mongez/supportive-is";
import axios, { AxiosInstance } from "axios";
import { Obj } from "@mongez/reinforcements";
import { getHttpConfig, getHttpConfigurations } from "./configurations";
import concatRoute from "@mongez/concat-route";

let cancelToken;

let lastRequestInfo = {};

const endpoint: AxiosInstance = axios.create({
  transformRequest: [
    function (data, headers) {
      const currentConfigurations = getHttpConfigurations();
      const transformPutRequest =
        headers.isPutRequest && currentConfigurations.putToPost;

      if (Is.formElement(data)) {
        data = new FormData(data);
      }

      if (Is.formData(data)) {
        if (transformPutRequest) {
          data.append(currentConfigurations.putMethodKey, "PUT");
        }
      }

      if (currentConfigurations.formDataToJSON && Is.formData(data)) {
        data = currentConfigurations.formDataToJSONSerializer(data);
      }

      if (Is.plainObject(data)) {
        headers["Content-Type"] = "Application/json";

        if (transformPutRequest) {
          data[currentConfigurations.putMethodKey] = "PUT";
        }

        data = JSON.stringify(data);
      }

      // delete the isPutRequest flag
      delete headers.isPutRequest;

      return data;
    },
  ],
  ...getHttpConfig("axiosConfig", {}),
});

endpoint.interceptors.request.use((requestConfig) => {
  const currentConfigurations = getHttpConfigurations();
  // // concat the base url with the requested route
  requestConfig.url = concatRoute(
    currentConfigurations.baseUrl,
    requestConfig.url
  );

  // A workaround for put requests to be sent as post request
  // this will allow us to upload images
  if (
    requestConfig.method === "put" &&
    currentConfigurations.putToPost === true
  ) {
    requestConfig.headers["isPutRequest"] = true as any; // just a flag
    requestConfig.method = "post";
  }

  const authHeader = currentConfigurations.setAuthorizationHeader;
  if (authHeader) {
    requestConfig.headers.Authorization =
      typeof authHeader === "function" ? authHeader() : authHeader;
  }

  // this will be used mainly with lastRequest
  // and with useRequest hook as well
  const CancelToken = axios.CancelToken;

  requestConfig.cancelToken = new CancelToken((c) => (cancelToken = c));

  // capture last request info
  lastRequestInfo = requestConfig;

  // trigger event of sending ajax request
  endpointEvents.trigger("sending", requestConfig);

  return requestConfig;
});

// when response is returned from the request
endpoint.interceptors.response.use(
  (response: any) => {
    // trigger success response
    endpointEvents.trigger("send", response);
    endpointEvents.trigger("success", response);
    return response;
  },
  (responseError) => {
    // trigger error response
    endpointEvents.trigger("send", responseError.response);
    endpointEvents.trigger("error", responseError.response);
    throw responseError;
  }
);

/**
 * Get last request
 * This function MUST BE called directly after sending the request so we can cancel the
 * last ajax request, and also to get any info we need about it as well
 *
 * @returns {object}
 */
export const lastRequest = () => {
  return {
    requestConfig: lastRequestInfo,
    cancelToken: Obj.clone(cancelToken),
    abort() {
      this.cancelToken();
    },
  };
};

export default endpoint;
